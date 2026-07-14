import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { pullOlderMessages } from "@/server/loop-agent";
import { useAppStore } from '@/lib/store';
import { ChatMessage } from "@deepclaw/core";
import { getLogger } from "@/lib/logger";

const logger = getLogger('useScrollHooks');

export function useScroll(
    agentMessages: ChatMessage[],
    scrollRef: React.RefObject<HTMLDivElement | null>,
    loopId: string,
) {
    const stickToBottomRef = useRef(true);
    const loadingOlderRef = useRef(false);
    const hasMoreRef = useRef(true);
    const prevScrollHeightRef = useRef(0);
    const adjustingScrollRef = useRef(false);

    const getOldestMessageId = useAppStore(s => s.getOldestMessageId);
    const addPulledMessages = useAppStore(s => s.addPulledMessages);

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

    // Reset pagination state when loopId changes
    useEffect(() => {
        hasMoreRef.current = true;
        loadingOlderRef.current = false;
        adjustingScrollRef.current = false;
        stickToBottomRef.current = true;
    }, [loopId]);

    const loadOlder = useCallback(async () => {
        if (loadingOlderRef.current || !hasMoreRef.current) return;
        const el = scrollRef.current;
        if (!el) return;

        loadingOlderRef.current = true;

        try {
            const oldestId = getOldestMessageId(loopId);
            const messages = await pullOlderMessages(loopId, oldestId);
            if (messages.length > 0) {
                prevScrollHeightRef.current = el.scrollHeight;
                adjustingScrollRef.current = true;
                addPulledMessages(loopId, messages, true);
            } else {
                hasMoreRef.current = false;
            }
        } catch (err) {
            logger.error(`Failed to load older messages: ${err}`);
        } finally {
            loadingOlderRef.current = false;
        }
    }, [loopId, getOldestMessageId, addPulledMessages, scrollRef]);

    return () => {
      const el = scrollRef.current;
      if (!el) return;
      stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      if (el.scrollTop < 50) {
          loadOlder();
      }
    };
}
