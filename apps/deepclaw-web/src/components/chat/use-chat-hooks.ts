import { useEffect, useRef } from "react";
import { useSSEClient } from '@/components/layout/SSEProvider';
import { SSECancelInteractEvent, SSEChatEvent, SSEConnectedEvent, SSEInteractEvent, SSELoopBusyEvent, SSELoopStreamEvent } from "@/app/api/sse-types";
import { getLogger } from "@/lib/logger";
import { useModalStore } from '@/lib/modal-store';
import { invoke, pullNewerMessages, pushChatMessage, resolveInteraction, updateChatMessage, resumeLoop } from "@/server/loop-agent";
import { useAppStore } from '@/lib/store';
import { useTranslation } from 'react-i18next';
import { AgentEmployee, ChatMessage, LOOP_BUSY_ERROR, newMessage } from "@deepclaw/core";

const logger = getLogger('useChatHooks');

function loopSSEConnection(browserId: string, loopId: string): string {
    const params = new URLSearchParams({ loopId, browserId });
    return `/api/loop?${params.toString()}`;
}

export function useInitChat(chatKey: string, chatKeyChanged: boolean,
    setChatInited: React.Dispatch<React.SetStateAction<boolean>>
) {
    const addPulledMessages = useAppStore(s => s.addPulledMessages);
    const getNewestMessageId = useAppStore(s => s.getNewestMessageId);
    const browserId = useAppStore(s => s.browserId);
    const messagePullingRef = useRef(false);

    useEffect(() => {
      if (!chatKeyChanged && messagePullingRef.current) return;
      messagePullingRef.current = true;
      pullNewerMessages(chatKey, getNewestMessageId(chatKey)).then(messages => {
          addPulledMessages(chatKey, messages);
      }).then(() => {
        return resumeLoop(browserId, chatKey);
      }).catch(err => {
          logger.error('Failed to pull chat messages:', err);
      }).finally(() => {
          setChatInited(true);
          messagePullingRef.current = false;
      });
    }, [chatKey, chatKeyChanged, addPulledMessages, getNewestMessageId, setChatInited, browserId]);
}

export function useSSEConnection(
    chatInited: boolean,
    loopId: string,
) {
    const browserId = useAppStore(s => s.browserId);
    const sseClient = useSSEClient();
    const showModal = useModalStore(s => s.showModal);
    const closeModal = useModalStore(s => s.closeModal);
    const addMessage = useAppStore(s => s.addMessage);
    const updateMessage = useAppStore(s => s.updateMessage);
    const setChatBusy = useAppStore(s => s.setChatBusy);

    useEffect(() => {
        if (!chatInited) return;
        const sseUrl = loopSSEConnection(browserId, loopId);
        const unsubscribers = [
          sseClient.subscribe<SSEConnectedEvent>(
            sseUrl,
            'connected',
            ({content}) => {
              if (content !== browserId) return;
              logger.info(`Connected for ${content}.`);
            },
          ),
          sseClient.subscribe<SSELoopBusyEvent>(
            sseUrl,
            'loopBusy',
            (data) => {
              if (data.loopId !== loopId) return;
              setChatBusy(loopId, data.busy);
            },
          ),
          sseClient.subscribe<SSEInteractEvent>(
            sseUrl,
            'interact',
            (data) => {
              if (data.loopId !== loopId || data.browserId !== browserId) return;
              showModal(loopId, data.content).then((answer) => {
                if (answer === null) return;
                resolveInteraction(browserId, loopId, answer).catch((err) => {
                  logger.error('Failed to resolve interaction:', err);
                });
              });
            },
          ),
          sseClient.subscribe<SSECancelInteractEvent>(
            sseUrl,
            'cancelInteract',
            (data) => {
              if (data.loopId !== loopId || data.browserId !== browserId) return;
              closeModal(null);
            },
          ),
          sseClient.subscribe<SSEChatEvent>(
            sseUrl,
            'chat',
            (data) => {
              if (data.loopId !== loopId || data.browserId === browserId) return;
              if (data.update) {
                updateMessage(loopId, data.content.id, data.content.content);
              } else {
                addMessage(loopId, data.content);
              }
            },
          ),
        ];
    
        return () => {
          unsubscribers.forEach(unsubscribe => unsubscribe());
        };
    }, [chatInited, loopId, sseClient, setChatBusy, showModal, closeModal, addMessage, browserId, updateMessage]);
}

export function useScroll(agentMessages: ChatMessage[], scrollRef: React.RefObject<HTMLDivElement | null>) {
    const stickToBottomRef = useRef(true);

    const lastContent = agentMessages?.[agentMessages.length - 1]?.content ?? '';
    useEffect(() => {
        const el = scrollRef.current;
        if (el && stickToBottomRef.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [agentMessages?.length, lastContent, scrollRef]);

    useEffect(() => {
        stickToBottomRef.current = true;
    }, [agentMessages]);
  
    return () => {
      const el = scrollRef.current;
      if (!el) return;
      stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    };
}

export function useSend(
    chatKey: string,
    agent: AgentEmployee,
    projectId: string,
    input: string,
    setInput: React.Dispatch<React.SetStateAction<string>>,
    streaming: boolean,
    setStreaming: React.Dispatch<React.SetStateAction<boolean>>,
) {
    const browserId = useAppStore(s => s.browserId);
    const addMessage = useAppStore(s => s.addMessage);
    const updateMessage = useAppStore(s => s.updateMessage);
    const getMessageById = useAppStore(s => s.getMessageById);
    const setChatBusy = useAppStore(s => s.setChatBusy);
    const sseClient = useSSEClient();
    const locked = useAppStore(s => !!s.busyChatKeys[chatKey]);
    const { t } = useTranslation();
    
    const loopId = chatKey;
    const sseUrl = loopSSEConnection(browserId, loopId);

    function addAndFireMessage(msg: ChatMessage) {
        addMessage(loopId, msg);
        pushChatMessage(browserId, loopId, msg);
    }

    function persistLoopSSE(msgId: string) {
        return sseClient.subscribePersistent<SSELoopStreamEvent>(
          sseUrl,
          'streamText',
          (data) => {
            if (data.loopId !== loopId || data.browserId !== browserId) return;
            if (!data.done) {
              updateMessage(data.loopId, msgId, data.content);
            } else {
              const msg = getMessageById(data.loopId, msgId);
              if (msg) {
                updateChatMessage(browserId, data.loopId, msg.id, msg.content);
              }
              setStreaming(false);
            }
          },
          {
            removeOn: ({done}) => done,
          },
        );
    }

    const handleSend = async () => {
        const trimmed = input.trim();
        if (!trimmed || streaming || locked) return;
    
        setInput('');
        setStreaming(true);
        setChatBusy(loopId, true);
        addAndFireMessage(newMessage('user', agent.id, trimmed));
        const newAgentMsg = newMessage('agent', agent.id, '');
        addAndFireMessage(newAgentMsg);
        const unsubscribeMessageStream = persistLoopSSE(newAgentMsg.id);
        invoke(browserId, agent.id, projectId, trimmed).catch(err => {
            unsubscribeMessageStream();
            const busy = err instanceof Error && err.message === LOOP_BUSY_ERROR;
            const text = busy ? t('web.pages.chat.busy', { name: agent.name }) : t('web.pages.chat.invoke.error');
            updateMessage(loopId, newAgentMsg.id, `\n${text}`);
            updateChatMessage(browserId, loopId, newAgentMsg.id, `\n${text}`);
            setStreaming(false);
            setChatBusy(loopId, busy);
        });
      };
    
      const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
        if (e.key === 'Enter') {
          if (e.nativeEvent.isComposing) {
            e.preventDefault();
            e.stopPropagation();
          } else {
            handleSend();
          }
        }
      };

    return {
      handleSend,
      handleKeyDown,
    };
}
