import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { pullOlderMessages } from "@/server/loop-agent";
import { useAppStore } from '@/lib/store';
import { ChatMessage } from "@deepclaw/core";
import { getLogger } from "@/lib/logger";

const logger = getLogger('useScrollHooks');

/**
 * The chat key names what is being read rather than which loop it belongs to, since a conversation
 * that was closed is read alongside the live one and pages on its own. What pulls the older
 * messages comes with it: the live chat and one being read back are asked for by different names.
 */
export function useScroll(
    agentMessages: ChatMessage[],
    scrollRef: React.RefObject<HTMLDivElement | null>,
    chatKey: string,
    pullOlder?: (endMessageId: string) => Promise<ChatMessage[]>,
) {
    const stickToBottomRef = useRef(true);
    const loadingOlderRef = useRef(false);
    const hasMoreRef = useRef(true);
    const prevScrollHeightRef = useRef(0);
    const adjustingScrollRef = useRef(false);
    const filledAboveRef = useRef<string | undefined>(undefined);

    const getOldestMessageId = useAppStore(s => s.getOldestMessageId);
    const addPulledMessages = useAppStore(s => s.addPulledMessages);

    const pullLive = useCallback(
        (endMessageId: string) => pullOlderMessages(chatKey, endMessageId), [chatKey]
    );
    const pull = pullOlder ?? pullLive;

    const lastContent = agentMessages?.[agentMessages.length - 1]?.content ?? '';
    useEffect(() => {
        const el = scrollRef.current;
        if (el && stickToBottomRef.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [agentMessages?.length, lastContent, scrollRef]);

    // Restore scroll position after older messages are prepended
    useLayoutEffect(() => {
        if (adjustingScrollRef.current && scrollRef.current) {
            const el = scrollRef.current;
            const diff = el.scrollHeight - prevScrollHeightRef.current;
            if (diff > 0) {
                el.scrollTop += diff;
            }
            // Don't reset adjustingScrollRef here — effect B needs to see it
        }
    });

    useEffect(() => {
        if (!adjustingScrollRef.current) {
            stickToBottomRef.current = true;
        }
        adjustingScrollRef.current = false; // Reset here, after the guard
    }, [agentMessages]);

    /**
     * Reset pagination state when what is being read changes, and when there is nothing left of it.
     * A conversation that was closed empties the chat under the very same name, which is as much a
     * different thing to read as a different name would be: a view that had already paged to the
     * top of the old one would otherwise never page again.
     */
    const nothingHeld = !agentMessages?.length;
    useEffect(() => {
        hasMoreRef.current = true;
        loadingOlderRef.current = false;
        adjustingScrollRef.current = false;
        stickToBottomRef.current = true;
        filledAboveRef.current = undefined;
    }, [chatKey, nothingHeld]);

    const loadOlder = useCallback(async () => {
        if (loadingOlderRef.current || !hasMoreRef.current) return;
        const el = scrollRef.current;
        if (!el) return;

        // Without an anchor the pull would return the newest page, which the initial load owns.
        const oldestId = getOldestMessageId(chatKey);
        if (!oldestId) return;

        loadingOlderRef.current = true;

        try {
            const messages = await pull(oldestId);
            if (messages.length > 0) {
                prevScrollHeightRef.current = el.scrollHeight;
                adjustingScrollRef.current = true;
                addPulledMessages(chatKey, messages, true);
            } else {
                hasMoreRef.current = false;
            }
        } catch (err) {
            logger.error(`Failed to load older messages: ${err}`);
        } finally {
            loadingOlderRef.current = false;
        }
    }, [chatKey, pull, getOldestMessageId, addPulledMessages, scrollRef]);

    /**
     * A page that stops short of the bottom of the panel leaves nothing to scroll, and scrolling is
     * the only thing that asks for the page before it: a short conversation would sit there with its
     * beginning out of reach. Pulled once per message it pulled from, so that a page holding nothing
     * that was not already held is the end of it rather than the start of it over again.
     */
    useEffect(() => {
        // Asked of the store before the panel, since reading a height is what forces the layout.
        const oldest = getOldestMessageId(chatKey);
        if (!oldest || oldest === filledAboveRef.current) return;
        const el = scrollRef.current;
        // A panel measuring nothing is one nobody is looking at, not one with room left in it. It
        // never comes to overflow however much is pulled in, so it would pull the whole history.
        if (!el || el.clientHeight === 0 || el.scrollHeight > el.clientHeight) return;
        filledAboveRef.current = oldest;
        loadOlder();
    }, [agentMessages, chatKey, getOldestMessageId, loadOlder, scrollRef]);

    return () => {
      const el = scrollRef.current;
      if (!el) return;
      stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      if (el.scrollTop < 50) {
          loadOlder();
      }
    };
}
