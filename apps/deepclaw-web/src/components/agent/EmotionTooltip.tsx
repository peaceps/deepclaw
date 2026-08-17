'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';

const AUTO_DISMISS_MS = 5000;
// max-w-56 (14rem): wide enough for a sentence, narrow enough to center on a collapsed card.
const ESTIMATED_WIDTH = 224;

/**
 * A transient bubble anchored to an agent card showing the emotion just pushed over SSE.
 * It fades in below the card, dismisses itself after a few seconds, and any click closes it.
 * Renders nothing while the store holds no popup for the agent.
 */
export function EmotionTooltip({ agentId, anchorRef }: {
    agentId: string;
    anchorRef: React.RefObject<HTMLDivElement | null>;
}) {
    const popup = useAppStore(s => s.emotionPopup[agentId]);
    if (!popup) {
        return null;
    }
    // Keyed by seq so a new emotion remounts the bubble, which replays the fade-in and re-arms
    // the timer without any state to reset.
    return <Bubble key={popup.seq} agentId={agentId} text={popup.text} at={popup.at} anchorRef={anchorRef}/>;
}

function Bubble({ agentId, text, at, anchorRef }: {
    agentId: string;
    text: string;
    at: number;
    anchorRef: React.RefObject<HTMLDivElement | null>;
}) {
    const dismissEmotionPopup = useAppStore(s => s.dismissEmotionPopup);
    const bubbleRef = useRef<HTMLDivElement>(null);
    const dismiss = useCallback(() => dismissEmotionPopup(agentId), [dismissEmotionPopup, agentId]);

    // Anchoring writes to the DOM rather than to state: the bubble carries no React state at all,
    // so an emotion arriving never costs the card an extra render. It stays hidden until placed.
    useLayoutEffect(() => {
        // A card that was not mounted when the emotion arrived would otherwise pop a bubble that
        // is minutes old, since the dismiss timer only runs while the bubble is on screen.
        if (Date.now() - at >= AUTO_DISMISS_MS) {
            return;
        }
        const place = () => {
            const bubble = bubbleRef.current;
            const anchor = anchorRef.current;
            if (!bubble) {
                return;
            }
            if (!anchor) {
                bubble.style.visibility = 'hidden';
                return;
            }
            const rect = anchor.getBoundingClientRect();
            const center = rect.left + rect.width / 2;
            // Keep the centered bubble inside the viewport even for cards in the collapsed list.
            const margin = ESTIMATED_WIDTH / 2 + 8;
            const left = Math.min(Math.max(center, margin), Math.max(window.innerWidth - margin, margin));
            bubble.style.top = `${rect.bottom + 8}px`;
            bubble.style.left = `${left}px`;
            bubble.style.visibility = 'visible';
        };
        place();
        // A fixed bubble is placed against the viewport, so any scroll slides the card out from
        // under it. Capture is what catches the agent list scrolling inside its own container.
        window.addEventListener('scroll', place, { passive: true, capture: true });
        window.addEventListener('resize', place);
        return () => {
            window.removeEventListener('scroll', place, { capture: true });
            window.removeEventListener('resize', place);
        };
    }, [anchorRef, at]);

    useEffect(() => {
        const remaining = AUTO_DISMISS_MS - (Date.now() - at);
        if (remaining <= 0) {
            dismiss();
            return;
        }
        const timer = setTimeout(dismiss, remaining);
        document.addEventListener('mousedown', dismiss);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', dismiss);
        };
    }, [dismiss, at]);

    return (
        <div
            ref={bubbleRef}
            onClick={e => {
                // The bubble sits inside the card's DOM tree; closing it should not select the agent.
                e.stopPropagation();
                dismiss();
            }}
            className="fixed z-50 max-w-56 px-3 py-2 bg-white rounded-xl shadow-xl border-2 border-amber-200
                text-sm text-gray-700 cursor-pointer select-none break-words
                animate-[emotion-pop-in_0.3s_ease-out]"
            style={{ visibility: 'hidden', transform: 'translateX(-50%)' }}
        >
            <span className="mr-1">💭</span>{text}
        </div>
    );
}
