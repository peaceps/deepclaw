import { useEffect, useRef } from "react";
import { useSSEClient } from '@/components/layout/SSEProvider';
import { SSECancelInteractEvent, SSEChatEvent, SSEConnectedEvent, SSEInteractEvent, SSELoopBusyEvent, SSELoopStreamEvent } from "@/app/api/sse-types";
import { getLogger } from "@/lib/logger";
import { useModalStore } from '@/lib/modal-store';
import { invoke, pullNewerMessages, pushChatMessage, resolveInteraction } from "@/server/loop-agent";
import { useAppStore } from '@/lib/store';
import { useTranslation } from 'react-i18next';
import { AgentEmployee, ChatMessage, LOOP_BUSY_ERROR } from "@deepclaw/core";

const logger = getLogger('useChatHooks');

function loopSSEConnection(browserId: string, loopId: string): string {
    const params = new URLSearchParams({ loopId, browserId });
    return `/api/loop?${params.toString()}`;
}

function newMessage(type: 'user' | 'agent', agentId: string, content: string): ChatMessage {
    return {
        id: crypto.randomUUID(),
        agentId,
        content,
        type,
        timestamp: new Date().toISOString(),
    };
}

export function useInitChat(chatKey: string, chatKeyChanged: boolean,
    setChatInited: React.Dispatch<React.SetStateAction<boolean>>
) {
    const addPulledMessages = useAppStore(s => s.addPulledMessages);
    const getNewestMessageId = useAppStore(s => s.getNewestMessageId);
    const messagePullingRef = useRef(false);

    useEffect(() => {
      if (!chatKeyChanged && messagePullingRef.current) return;
      messagePullingRef.current = true;
      pullNewerMessages(chatKey, getNewestMessageId(chatKey)).then(messages => {
          addPulledMessages(chatKey, messages);
      }).catch(err => {
          logger.error('Failed to pull chat messages:', err);
      }).finally(() => {
          setChatInited(true);
          messagePullingRef.current = false;
      });
    }, [chatKey, chatKeyChanged, addPulledMessages, getNewestMessageId, setChatInited]);
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
              if (data.loopId !== loopId || data.clientId !== browserId) return;
              showModal(loopId, data.content).then((answer) => {
                if (answer === null) return;
                resolveInteraction(loopId, browserId, answer).catch((err) => {
                  logger.error('Failed to resolve interaction:', err);
                });
              });
            },
          ),
          sseClient.subscribe<SSECancelInteractEvent>(
            sseUrl,
            'cancelInteract',
            (data) => {
              if (data.loopId !== loopId || data.clientId !== browserId) return;
              closeModal(null);
            },
          ),
          sseClient.subscribe<SSEChatEvent>(
            sseUrl,
            'chat',
            (data) => {
              if (data.loopId !== loopId || data.clientId === browserId) return;
              addMessage(loopId, data.content);
            },
          ),
        ];
    
        return () => {
          unsubscribers.forEach(unsubscribe => unsubscribe());
        };
    }, [chatInited, loopId, sseClient, setChatBusy, showModal, closeModal, addMessage, browserId]);
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
    const updateMessageStream = useAppStore(s => s.updateMessageStream);
    const getMessageById = useAppStore(s => s.getMessageById);
    const setChatBusy = useAppStore(s => s.setChatBusy);
    const sseClient = useSSEClient();
    const locked = useAppStore(s => !!s.busyChatKeys[chatKey]);
    const { t } = useTranslation();
    
    const loopId = chatKey;
    const sseUrl = loopSSEConnection(browserId, loopId);

    function persistLoopSSE(msgId: string) {
        return sseClient.subscribePersistent<SSELoopStreamEvent>(
          sseUrl,
          'streamText',
          (data) => {
            if (data.loopId !== loopId || data.clientId !== browserId) return;
            if (!data.done) {
              updateMessageStream(data.loopId, msgId, data.content);
            } else {
              const msg = getMessageById(data.loopId, msgId);
              if (msg) {
                pushChatMessage(data.loopId, browserId, msg);
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
        const newUserMsg = newMessage('user', agent.id, trimmed);
        addMessage(loopId, newUserMsg);
        pushChatMessage(loopId, browserId, newUserMsg);
        const newAgentMsg = newMessage('agent', agent.id, '');
        addMessage(loopId, newAgentMsg);
        const unsubscribeMessageStream = persistLoopSSE(newAgentMsg.id);
        invoke(agent.id, projectId, browserId, trimmed).catch(err => {
            unsubscribeMessageStream();
            const busy = err instanceof Error && err.message === LOOP_BUSY_ERROR;
            const text = busy ? t('web.pages.chat.busy', { name: agent.name }) : t('web.pages.chat.invoke.error');
            updateMessageStream(loopId, newAgentMsg.id, `\n${text}`);
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
