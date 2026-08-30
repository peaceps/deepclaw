import { useCallback, useEffect, useState } from "react";
import { useSSEClient } from '@/components/layout/SSEProvider';
import { sseUrl } from '@/lib/sse-client';
import { getLogger } from "@/lib/logger";
import { useInteractionModalStore } from '@/lib/interaction-modal-store';
import { useToastStore } from '@/lib/toast-store';
import {
    invoke, pullNewerMessages, pullOlderMessages, pushChatMessage,
    resolveInteraction, activeLoop, inactiveLoop,
    getTokenUsage, pullSessionMessages, startNewSession, stopLoop
} from "@/server/loop-agent";
import { useAppStore } from '@/lib/store';
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

/**
 * What this chat holds is behind whatever the server holds, and this is what closes the gap: the
 * newest message on the page names the place to carry on from, and a page that holds nothing yet
 * asks for the last one instead.
 *
 * A cursor comes back with the message it names, so an answer with nothing in it is not "nothing
 * new" -- it is a message the server cannot place. One never written down, or one written in a
 * conversation it has since let go of and read back from the disk without it. Left at that, this
 * chat would go on asking from a message that will never resolve and never be handed another thing
 * said in it, without so much as an error to show for it, until the page is loaded again. So the
 * last page is asked for whole, which the store merges into what it already holds by id.
 *
 * The last page and no further, which leaves a gap where more than a page was said after the
 * message that cannot be placed: what this chat holds is joined straight onto a page that does not
 * follow it, and the join does not show. Paging up will not close it either -- that asks from the
 * oldest message held, which is on the far side of the gap. Left as it is on purpose. Asking back
 * from the page until it meets what is held costs a round of requests every time the fallback runs,
 * and dropping what is held instead would throw away a long history scrolled up by hand in the far
 * commoner case where the page does follow it. Closing it properly is the server's to do: an answer
 * that says "I cannot place this" rather than an empty one would let this ask again knowing what it
 * is missing, instead of guessing from a page.
 */
export async function pullMessagesFrom(loopId: string, newestMessageId?: string): Promise<ChatMessage[]> {
    if (!newestMessageId) {
        return pullOlderMessages(loopId);
    }
    const newer = await pullNewerMessages(loopId, newestMessageId);
    if (newer.length) {
        return newer;
    }
    logger.warn(
        `The server cannot place ${newestMessageId} of ${loopId}. Asking for the last page instead, `
        + 'which leaves out whatever was said between the two.'
    );
    return pullOlderMessages(loopId);
}

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
      pullMessagesFrom(loopId, newestMessageId).then(messages => {
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
    chatInited: boolean,
    input: string,
    setInput: React.Dispatch<React.SetStateAction<string>>,
    pendingImages: ImageContent[],
    clearImages: () => void,
) {
    const browserId = useAppStore(s => s.browserId);
    const addMessage = useAppStore(s => s.addMessage);
    const setChatBusy = useAppStore(s => s.setChatBusy);
    const locked = useAppStore(s => !!s.busyChatKeys[loopId]);
    const subscribeStream = useStreamIntoMessage(browserId, loopId);
    const {t} = useTranslation();

    function addAndFireMessage(msg: ChatMessage) {
        addMessage(loopId, msg);
        pushChatMessage(browserId, loopId, msg);
    }

    const handleSend = async () => {
        const trimmed = input.trim();
        if ((!trimmed && pendingImages.length === 0) || locked) return;
        // Not before the messages already said are in hand. One sent now goes into a chat that is
        // still empty, and the history landing after it is put in behind what is held: the word
        // just written would sit above every word that came before it. The box and the button are
        // both dead while this is, so nothing on the screen reaches here -- this is the same rule
        // said where sending happens, sending being what it is a rule about.
        if (!chatInited) return;
    
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
    
      const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
        if (e.key !== 'Enter') return;
        // Shift+Enter belongs to the box: what is written there can run to more than one line, and
        // this is the key that writes the break. Enter alone sends, and takes the key with it --
        // left to the box, it would put the break into the empty box the send just left behind.
        if (e.shiftKey) return;
        if (e.nativeEvent.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.preventDefault();
        handleSend();
      };

    return {
      handleSend,
      handleKeyDown,
    };
}

/**
 * Writes an answer into the message it belongs to as it is read off the stream.
 *
 * Only onto the screen: what the run said is written down by the server that heard it say so, and
 * arrives here again as the whole message once the run is over. The tab sending its own copy back
 * would be a second writer of one message, and the later of the two wins -- which is whichever the
 * network happened to favour, over text the run had already ended with.
 */
function useStreamIntoMessage(
    browserId: string, loopId: string,
): (msgId: string) => () => void {
    const updateMessage = useAppStore(s => s.updateMessage);
    const sseClient = useSSEClient();

    const stream = useCallback((msgId: string) => sseClient.subscribePersistent<AgentStreamEvent>(
      sseUrl(browserId),
      'stream',
      (event) => {
        // A tagged frame is a tool saying something about itself, in whatever shape that tool
        // chose, and it is no part of the answer being written here: the chat is written from
        // what the run said, and a frame nobody rewrites into words would stand in the message
        // until the run ended and then be wiped by the answer landing over it.
        if (event.loopId !== loopId || event.browserId !== browserId || event.done || event.tag) {
          return;
        }
        updateMessage(event.loopId, msgId, event.text);
      },
      {
        removeOn: ({done}) => !!done,
        // Two chats of one tab now share the stream, so each has to keep a listener of its own.
        key: loopId,
      },
    ), [browserId, loopId, sseClient, updateMessage]);

    return stream;
}
