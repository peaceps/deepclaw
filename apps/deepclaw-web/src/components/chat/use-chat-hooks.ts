import { useCallback, useEffect, useRef } from "react";
import { useSSEClient } from '@/components/layout/SSEProvider';
import { SSECancelInteractEvent, SSEChatEvent, SSEConnectedEvent, SSEInteractEvent, SSELoopBusyEvent, SSELoopStreamEvent } from "@/app/api/sse-types";
import { getLogger } from "@/lib/logger";
import { useModalStore } from '@/lib/modal-store';
import { invoke, pullNewerMessages, pushChatMessage, resolveInteraction, updateChatMessage, resumeLoop } from "@/server/loop-agent";
import { useAppStore } from '@/lib/store';
import { AgentEmployee, ChatMessage, newMessage } from "@deepclaw/core";
import { useTranslation } from "react-i18next";

const logger = getLogger('useChatHooks');

function loopSSEConnection(browserId: string, loopId: string): string {
    const params = new URLSearchParams({ loopId, browserId });
    return `/api/loop?${params.toString()}`;
}

export function useInitChat(chatKey: string,
    setChatInited: React.Dispatch<React.SetStateAction<boolean>>,
    setInput: React.Dispatch<React.SetStateAction<string>>,
) {
    const loopId = chatKey;
    const addPulledMessages = useAppStore(s => s.addPulledMessages);
    const getNewestMessageId = useAppStore(s => s.getNewestMessageId);
    const browserId = useAppStore(s => s.browserId);

    useEffect(() => {
      setInput('');
      let cancelled = false;
      const newestMessageId = getNewestMessageId(chatKey);
      pullNewerMessages(chatKey, newestMessageId).then(messages => {
          if (cancelled) return;
          addPulledMessages(chatKey, messages);
      }).catch(err => {
          if (cancelled) return;
          logger.error('Failed to pull chat messages:', err);
      }).finally(() => {
          if (cancelled) return;
          setChatInited(true);
      });

      return () => {
        cancelled = true;
        setChatInited(false);
      }
    }, [
        browserId, chatKey, setInput, addPulledMessages,
        getNewestMessageId, setChatInited
    ]);
}

export function useSSEConnection(
    chatInited: boolean,
    loopId: string,
    setListening: React.Dispatch<React.SetStateAction<boolean>>,
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

        setListening(true);
    
        return () => {
          unsubscribers.forEach(unsubscribe => unsubscribe());
          setListening(false);
        };
    }, [
        chatInited, loopId, sseClient, setChatBusy,
        showModal, closeModal, addMessage,
        setListening, browserId, updateMessage
    ]);
}

export function useLoopResume(listening: boolean, loopId: string) {
    const browserId = useAppStore(s => s.browserId);
    const getNewestMessageId = useAppStore(s => s.getNewestMessageId);
    const subscribeStream = usePersistStream(browserId, loopId);

    useEffect(() => {
        if (!listening) return;
        const newestMessageId = getNewestMessageId(loopId);
        let unsubscribe: (() => void) | null = null;

        let cancelled = false;
        resumeLoop(browserId, loopId).then((resume) => {
          if (cancelled) return;
          if (newestMessageId && resume) unsubscribe = subscribeStream(newestMessageId);
        });

        return () => { cancelled = true; unsubscribe?.(); };

    }, [listening, browserId, loopId, getNewestMessageId, subscribeStream])
}

export function useSend(
    chatKey: string,
    agent: AgentEmployee,
    projectId: string,
    input: string,
    setInput: React.Dispatch<React.SetStateAction<string>>,
) {
    const loopId = chatKey;
    const browserId = useAppStore(s => s.browserId);
    const addMessage = useAppStore(s => s.addMessage);
    const setChatBusy = useAppStore(s => s.setChatBusy);
    const locked = useAppStore(s => !!s.busyChatKeys[chatKey]);
    const subscribeStream = usePersistStream(browserId, loopId);
    const { t } = useTranslation();
    const invokeError = useInvokeError(browserId, loopId);

    function addAndFireMessage(msg: ChatMessage) {
        addMessage(loopId, msg);
        pushChatMessage(browserId, loopId, msg);
    }

    const handleSend = async () => {
        const trimmed = input.trim();
        if (!trimmed || locked) return;
    
        setInput('');
        setChatBusy(loopId, true);
        addAndFireMessage(newMessage('user', agent.id, trimmed));
        const newAgentMsg = newMessage('agent', agent.id, '');
        addAndFireMessage(newAgentMsg);
        const unsubscribe = subscribeStream(newAgentMsg.id);
        invoke(browserId, agent.id, projectId, trimmed).then((busy: boolean) => {
            if (busy) {
                invokeError(newAgentMsg.id, t('web.pages.chat.busy', { name: agent.name }), true, unsubscribe);
            }
        }).catch((e: any) => {
            logger.error(`Failed to invoke ${loopId}:`, e);
            invokeError(newAgentMsg.id, t('web.pages.chat.invoke.error'), false, unsubscribe);
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

function useInvokeError(browserId: string, loopId: string): (
    msgId: string, text: string, busy: boolean, unsubscribe: () => void
) => void {
    const setChatBusy = useAppStore(s => s.setChatBusy);
    const updateMessage = useAppStore(s => s.updateMessage);

    return useCallback((msgId: string, text: string, busy: boolean, unsubscribe: () => void) => {
        unsubscribe();
        updateMessage(loopId, msgId, text);
        updateChatMessage(browserId, loopId, msgId, text);
        setChatBusy(loopId, busy);
    }, [browserId, loopId, updateMessage, setChatBusy]);
}

function usePersistStream(
    browserId: string, loopId: string,
): (msgId: string) => () => void {
    const getMessageById = useAppStore(s => s.getMessageById);
    const updateMessage = useAppStore(s => s.updateMessage);
    const sseClient = useSSEClient();

    const stream = useCallback((msgId: string) => sseClient.subscribePersistent<SSELoopStreamEvent>(
      loopSSEConnection(browserId, loopId),
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
        }
      },
      {
        removeOn: ({done}) => done,
      },
    ), [browserId, loopId, getMessageById, sseClient, updateMessage]);

    return stream;
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
