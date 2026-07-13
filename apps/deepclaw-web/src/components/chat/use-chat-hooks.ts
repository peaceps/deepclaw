import { useCallback, useEffect, useRef } from "react";
import { useSSEClient } from '@/components/layout/SSEProvider';
import { SSEConnectedEvent } from "@/app/api/sse-types";
import { getLogger } from "@/lib/logger";
import { useModalStore } from '@/lib/modal-store';
import { invoke, pullNewerMessages, pushChatMessage, resolveInteraction, updateChatMessage, resumeLoop, inactiveLoop } from "@/server/loop-agent";
import { useAppStore } from '@/lib/store';
import { AgentEmployee, AgentInteractionEvent, AgentStreamEvent, ChatMessage, newMessage } from "@deepclaw/core";
import { useTranslation } from "react-i18next";
import { AgentCancelInteractionEvent, AgentChatEvent, AgentLoopBusyEvent } from "@deepclaw/loop-gateway";

const logger = getLogger('useChatHooks');

function loopSSEConnection(browserId: string, loopId: string): string {
    const params = new URLSearchParams({ loopId, browserId });
    return `/api/loop?${params.toString()}`;
}

export function useInitChat(loopId: string,
    setChatInited: React.Dispatch<React.SetStateAction<boolean>>,
    setInput: React.Dispatch<React.SetStateAction<string>>,
) {
    const addPulledMessages = useAppStore(s => s.addPulledMessages);
    const getNewestMessageId = useAppStore(s => s.getNewestMessageId);
    const browserId = useAppStore(s => s.browserId);

    useEffect(() => {
      setInput('');
      let cancelled = false;
      const newestMessageId = getNewestMessageId(loopId);
      pullNewerMessages(loopId, newestMessageId).then(messages => {
          if (cancelled) return;
          addPulledMessages(loopId, messages);
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
        inactiveLoop(browserId, loopId);
      }
    }, [
        browserId, loopId, setInput, addPulledMessages,
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
    const replaceMessage = useAppStore(s => s.replaceMessage);
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
          sseClient.subscribe<AgentLoopBusyEvent>(
            sseUrl,
            'busy',
            (event) => {
              if (event.loopId !== loopId) return;
              setChatBusy(loopId, event.busy);
            },
          ),
          sseClient.subscribe<AgentInteractionEvent>(
            sseUrl,
            'interaction',
            (event) => {
              if (event.loopId !== loopId || event.browserId !== browserId) return;
              showModal(loopId, event).then((answer) => {
                if (answer === null) return;
                resolveInteraction(browserId, loopId, answer).catch((err) => {
                  logger.error('Failed to resolve interaction:', err);
                });
              });
            },
          ),
          sseClient.subscribe<AgentCancelInteractionEvent>(
            sseUrl,
            'cancelInteraction',
            (event) => {
              if (event.loopId !== loopId || event.browserId !== browserId) return;
              closeModal(null);
            },
          ),
          sseClient.subscribe<AgentChatEvent>(
            sseUrl,
            'chat',
            (event) => {
              if (event.loopId !== loopId || event.browserId === browserId) return;
              if (event.update) {
                replaceMessage(loopId, event.message.id, event.message.content);
              } else {
                addMessage(loopId, event.message);
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
    const subscribeStream = usePersistStream(browserId, loopId);

    useEffect(() => {
        if (!listening) return;
        let unsubscribe: (() => void) | null = null;

        let cancelled = false;
        resumeLoop(browserId, loopId).then(({resume, msgId}) => {
          if (cancelled) return;
          if (msgId && resume) unsubscribe = subscribeStream(msgId);
        });

        return () => { cancelled = true; unsubscribe?.(); };

    }, [listening, browserId, loopId, subscribeStream])
}

export function useSend(
    loopId: string,
    agent: AgentEmployee,
    projectId: string,
    input: string,
    setInput: React.Dispatch<React.SetStateAction<string>>,
) {
    const browserId = useAppStore(s => s.browserId);
    const addMessage = useAppStore(s => s.addMessage);
    const setChatBusy = useAppStore(s => s.setChatBusy);
    const locked = useAppStore(s => !!s.busyChatKeys[loopId]);
    const subscribeStream = usePersistStream(browserId, loopId);
    const {t} = useTranslation();

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

        let unsubscribe: (() => void) | undefined = undefined;
        invoke(browserId, agent.id, projectId, trimmed).then(({busy, msgId}) => {
            if (busy) {
              setChatBusy(loopId, busy);
            } else {
              unsubscribe = subscribeStream(msgId);
            }
        }).catch((e: any) => {
            logger.error(`Failed to invoke ${loopId}:`, e);
            unsubscribe?.();
            setChatBusy(loopId, false);
            addMessage(loopId, newMessage('agent', agent.id, t('web.pages.chat.invoke.error')));
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

function usePersistStream(
    browserId: string, loopId: string,
): (msgId: string) => () => void {
    const getMessageById = useAppStore(s => s.getMessageById);
    const updateMessage = useAppStore(s => s.updateMessage);
    const sseClient = useSSEClient();

    const stream = useCallback((msgId: string) => sseClient.subscribePersistent<AgentStreamEvent>(
      loopSSEConnection(browserId, loopId),
      'stream',
      (event) => {
        if (event.loopId !== loopId || event.browserId !== browserId) return;
        if (!event.done) {
          updateMessage(event.loopId, msgId, event.text);
        } else {
          const msg = getMessageById(event.loopId, msgId);
          if (msg) {
            updateChatMessage(browserId, event.loopId, msg.id, msg.content);
          }
        }
      },
      {
        removeOn: ({done}) => !!done,
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
