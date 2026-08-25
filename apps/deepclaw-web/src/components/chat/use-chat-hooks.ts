import { useCallback, useEffect, useState } from "react";
import { useSSEClient } from '@/components/layout/SSEProvider';
import { sseUrl } from '@/lib/sse-client';
import { getLogger } from "@/lib/logger";
import { useInteractionModalStore } from '@/lib/interaction-modal-store';
import { useToastStore } from '@/lib/toast-store';
import {
    invoke, pullNewerMessages, pullOlderMessages, pushChatMessage,
    resolveInteraction, updateChatMessage, activeLoop, inactiveLoop,
    getTokenUsage, pullSessionMessages, startNewSession, stopLoop
} from "@/server/loop-agent";
import { useAppStore } from '@/lib/store';
import { keepReply } from '@/lib/kept-reply';
import {
    AgentEmployee, AgentInteractionEvent, AgentStreamEvent, ChatMessage, FlushAgentRole, newMessage,
    TokenUsage, type ImageContent
} from "@deepclaw/core";
import { useTranslation } from "react-i18next";
import {
    AgentCancelInteractionEvent, AgentChatEvent, AgentLoopBusyEvent, AgentSessionResetEvent,
    AgentTokenUsageEvent, NewSessionRefusal
} from "@deepclaw/loop-gateway";

const logger = getLogger('useChatHooks');

export function useInitChat(loopId: string,
    setChatInited: React.Dispatch<React.SetStateAction<boolean>>,
    setInput: React.Dispatch<React.SetStateAction<string>>,
    setTokenUsage: React.Dispatch<React.SetStateAction<TokenUsage | undefined>>,
) {
    const addPulledMessages = useAppStore(s => s.addPulledMessages);
    const getNewestMessageId = useAppStore(s => s.getNewestMessageId);
    const browserId = useAppStore(s => s.browserId);

    useEffect(() => {
      setInput('');
      let cancelled = false;
      const newestMessageId = getNewestMessageId(loopId);
      const pullPromise = newestMessageId
          ? pullNewerMessages(loopId, newestMessageId)
          : pullOlderMessages(loopId);
      pullPromise.then(messages => {
          if (cancelled) return;
          addPulledMessages(loopId, messages);
      }).catch(err => {
          if (cancelled) return;
          logger.error('Failed to pull chat messages:', err);
      }).finally(() => {
          if (cancelled) return;
          setChatInited(true);
      });

      getTokenUsage(loopId).then(usage => {
        setTokenUsage(usage);
      }).catch(() => setTokenUsage(undefined));

      return () => {
        cancelled = true;
        setChatInited(false);
        setTokenUsage(undefined);
        inactiveLoop(browserId, loopId);
      }
    }, [
        browserId, loopId, setInput, addPulledMessages,
        getNewestMessageId, setChatInited, setTokenUsage
    ]);
}

export function useSSEConnection(
    chatInited: boolean,
    loopId: string,
    setListening: React.Dispatch<React.SetStateAction<boolean>>,
    setTokenUsage: React.Dispatch<React.SetStateAction<TokenUsage | undefined>>,
) {
    const browserId = useAppStore(s => s.browserId);
    const sseClient = useSSEClient();
    const showModal = useInteractionModalStore(s => s.showModal);
    const closeModal = useInteractionModalStore(s => s.closeModal);
    const addMessage = useAppStore(s => s.addMessage);
    const updateMessage = useAppStore(s => s.updateMessage);
    const replaceMessage = useAppStore(s => s.replaceMessage);
    const clearMessages = useAppStore(s => s.clearMessages);
    const setChatBusy = useAppStore(s => s.setChatBusy);

    useEffect(() => {
        if (!chatInited) return;
        const url = sseUrl(browserId);
        // The greeting is spoken once, when the tab opens the stream, and the layout is there to
        // hear it: a chat that joins the stream later would only wait for a word already said.
        const unsubscribers = [
          sseClient.subscribe<AgentLoopBusyEvent>(
            url,
            'busy',
            (event) => {
              if (event.loopId !== loopId) return;
              setChatBusy(loopId, event.busy);
            },
          ),
          sseClient.subscribe<AgentInteractionEvent>(
            url,
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
            url,
            'cancelInteraction',
            (event) => {
              if (event.loopId !== loopId || event.browserId !== browserId) return;
              closeModal(null);
            },
          ),
          sseClient.subscribe<AgentChatEvent>(
            url,
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
          sseClient.subscribe<AgentTokenUsageEvent>(
            url,
            'tokenUsage',
            (event) => {
              if (event.loopId !== loopId || !event.usage) return;
                setTokenUsage(event.usage);
            },
          ),
          // Whoever closed the conversation is told along with the rest: their own view holds the
          // transcript too, and the tokens the closed session had spent are not this one's.
          sseClient.subscribe<AgentSessionResetEvent>(
            url,
            'sessionReset',
            (event) => {
              if (event.loopId !== loopId) return;
              clearMessages(loopId);
              setTokenUsage(undefined);
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
        showModal, closeModal, addMessage, setTokenUsage,
        setListening, browserId, updateMessage, replaceMessage, clearMessages
    ]);
}

/**
 * What the store holds a conversation that was closed under. It is read beside the live one rather
 * than in place of it, so the two cannot share a name: closing a conversation empties what the live
 * chat holds, and what is being read back is not that.
 */
export function archivedChatKey(loopId: string, sessionId: string): string {
    return `${loopId}#${sessionId}`;
}

/** Reads the newest page of a conversation that was closed. Nothing is ever written back to it. */
export function useArchivedChat(loopId: string, sessionId: string | null) {
    const addPulledMessages = useAppStore(s => s.addPulledMessages);
    const clearMessages = useAppStore(s => s.clearMessages);
    const held = useAppStore(s => !sessionId ? undefined : s.messages[archivedChatKey(loopId, sessionId)]);
    const loaded = !!held?.length;

    useEffect(() => {
        if (!sessionId || loaded) return;
        let cancelled = false;
        pullSessionMessages(loopId, sessionId).then(messages => {
            if (cancelled) return;
            addPulledMessages(archivedChatKey(loopId, sessionId), messages);
        }).catch(err => {
            logger.error(`Failed to pull an archived conversation: ${err}`);
        });
        return () => {
            cancelled = true;
        };
    }, [loopId, sessionId, loaded, addPulledMessages]);

    /**
     * Let go of once the reading is over, and kept for as long as it lasts however far back the
     * user pages. Held on to after that, every conversation anybody opened would stay in the tab
     * for as long as the tab did. Kept apart from the effect that loads it, which runs again the
     * moment the first page lands and would throw it away as soon as it arrived.
     */
    useEffect(() => {
        if (!sessionId) return;
        return () => clearMessages(archivedChatKey(loopId, sessionId));
    }, [loopId, sessionId, clearMessages]);

    // Paging back only means anything while a conversation that was closed is being read. Asked
    // without one, the name would have to be made up, and an empty one reads as the live chat.
    const pullOlder = useCallback(
        (endMessageId: string): Promise<ChatMessage[]> => !sessionId
            ? Promise.resolve([])
            : pullSessionMessages(loopId, sessionId, endMessageId),
        [loopId, sessionId]
    );

    return {messages: held ?? [], pullOlder};
}

/**
 * Closes the conversation of this loop. The transcript is not cleared here: the server says it was
 * closed to every view of the loop, this one included, and clearing it twice would race that.
 */
export function useNewSession(loopId: string): {
    startNew: () => Promise<void>, starting: boolean
} {
    const [starting, setStarting] = useState(false);
    const showToast = useToastStore(s => s.show);
    const {t} = useTranslation();

    const startNew = useCallback(async () => {
        setStarting(true);
        try {
            const result = await startNewSession(loopId);
            if (!result.started) {
                showToast({
                    type: 'warning',
                    message: t(`web.pages.chat.session.refused.${result.reason satisfies NewSessionRefusal}`)
                });
            }
        } catch (err) {
            logger.error(`Failed to start a new conversation of ${loopId}: ${err}`);
            showToast({type: 'error', message: t('web.pages.chat.session.error')});
        } finally {
            setStarting(false);
        }
    }, [loopId, showToast, t]);

    return {startNew, starting};
}

/**
 * Ends the run of this loop. Any view may end it, the one that started it and one that only
 * watches alike: while a run is on, every view of the loop is locked out of typing, so a stop that
 * only its own tab could press would hold the others to a tab that may already be closed.
 *
 * The button stays in the stopping state until the run really ends rather than until the request
 * comes back. The two are not the same moment: the signal ends what the run is waiting on, and a
 * command that ignores it runs to its end first. Pressing again in that gap does nothing the first
 * press has not already done, so the state is there to say so.
 *
 * Being told there was no run to stop is the one answer that has to be acted on rather than
 * waited out. It means this page is locked over a run the server does not have, which a stream
 * that dropped across a restart is enough to leave behind, and nothing further is coming to say
 * otherwise: the button would turn forever above an input the same lie keeps disabled. The page
 * takes the server at its word and unlocks, and says so, since a chat that frees itself without
 * a word looks like the stop worked on something.
 */
export function useStopLoop(loopId: string, locked: boolean): {
    stop: () => Promise<void>, stopping: boolean
} {
    const [stopping, setStopping] = useState(false);
    const [wasLocked, setWasLocked] = useState(locked);
    const setChatBusy = useAppStore(s => s.setChatBusy);
    const showToast = useToastStore(s => s.show);
    const {t} = useTranslation();

    // Adjusted while rendering rather than from an effect: the run ending is the one thing that
    // clears this, and an effect would leave the button saying it is still stopping for a frame
    // after the chat had already unlocked itself.
    if (wasLocked !== locked) {
        setWasLocked(locked);
        if (!locked) {
            setStopping(false);
        }
    }

    const stop = useCallback(async () => {
        setStopping(true);
        try {
            if (!await stopLoop(loopId)) {
                setStopping(false);
                setChatBusy(loopId, false);
                showToast({type: 'info', message: t('web.pages.chat.stop.ended')});
            }
        } catch (err) {
            logger.error(`Failed to stop the run of ${loopId}: ${err}`);
            showToast({type: 'error', message: t('web.pages.chat.stop.error')});
            setStopping(false);
        }
    }, [loopId, setChatBusy, showToast, t]);

    return {stop, stopping};
}

/**
 * Tells the server this view is on screen, which is what the events of the loop are sent by. A
 * question asked while nobody watched is handed over on the way in, so opening the chat is how the
 * user gets to the request a toast sent them after.
 */
export function useLoopWatch(listening: boolean, loopId: string) {
    const browserId = useAppStore(s => s.browserId);
    const sseClient = useSSEClient();

    useEffect(() => {
        if (!listening) return;
        activeLoop(browserId, loopId);
        // A stream that dropped and came back is a stream the server built anew, and it was told
        // nothing of the loops this page shows: without saying it again the chat goes deaf until
        // the user happens to open it once more.
        return sseClient.onReopen(sseUrl(browserId), () => {
            activeLoop(browserId, loopId);
        });
    }, [listening, browserId, loopId, sseClient])
}

export function useSend(
    loopId: string,
    role: FlushAgentRole,
    agent: AgentEmployee,
    projectId: string,
    input: string,
    setInput: React.Dispatch<React.SetStateAction<string>>,
    pendingImages: ImageContent[],
    clearImages: () => void,
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
        if ((!trimmed && pendingImages.length === 0) || locked) return;
    
        setInput('');
        clearImages();
        setChatBusy(loopId, true);
        const images = pendingImages.length > 0 ? pendingImages : undefined;
        addAndFireMessage(newMessage('user', agent.id, trimmed, images));

        let unsubscribe: (() => void) | undefined = undefined;
        invoke(browserId, role, agent.id, projectId, trimmed, images).then(({busy, msgId}) => {
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
      sseUrl(browserId),
      'stream',
      (event) => {
        if (event.loopId !== loopId || event.browserId !== browserId) return;
        if (!event.done) {
          updateMessage(event.loopId, msgId, event.text);
        } else {
          keepReply(getMessageById(event.loopId, msgId)?.content, event.text,
            text => updateChatMessage(browserId, event.loopId, msgId, text));
        }
      },
      {
        removeOn: ({done}) => !!done,
        // Two chats of one tab now share the stream, so each has to keep a listener of its own.
        key: loopId,
      },
    ), [browserId, loopId, getMessageById, sseClient, updateMessage]);

    return stream;
}
