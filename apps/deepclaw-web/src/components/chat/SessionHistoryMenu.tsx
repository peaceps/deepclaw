'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import type { SessionSummary } from '@deepclaw/loop-gateway';
import { popupPlacement, type PopupPlacement } from '@/laf/popup-placement';
import { listSessions } from '@/server/loop-agent';
import { formatDate } from '../component-utils';
import { formatCount } from '@/lib/number-format';
import { getLogger } from '@/lib/logger';

const logger = getLogger('SessionHistoryMenu');

/**
 * Wide enough for a line of a conversation to be worth reading, and no taller than a list somebody
 * scrolls rather than searches. What a session was is cut to the width instead of widening the list.
 */
const LIST_WIDTH = 288;
const LIST_MAX_HEIGHT = 320;

type SessionHistoryMenuProps = {
    loopId: string;
    viewingSessionId: string | null;
    anchorRef: React.RefObject<HTMLElement | null>;
    onPick: (sessionId: string) => void;
    onClose: () => void;
};

function totalTokens(session: SessionSummary): number {
    const {cachedInputTokens, noCachedInputTokens, outputTokens} = session.usage;
    return cachedInputTokens + noCachedInputTokens + outputTokens;
}

/** When the conversation was had, which is when it began unless nothing there says so. */
function startedAt(session: SessionSummary): string {
    return session.startedAt ?? session.updatedAt;
}

/**
 * The conversations of this agent that were closed, hung on the button that opened them, under it or
 * above it by whichever side of the button the page has room on. In a portal because the chat it
 * belongs to scrolls its own way and a list drawn inside one would be cut off by it.
 */
export function SessionHistoryMenu({
    loopId, viewingSessionId, anchorRef, onPick, onClose,
}: SessionHistoryMenuProps) {
    const { t, i18n } = useTranslation();
    const listRef = useRef<HTMLDivElement>(null);
    const [placement, setPlacement] = useState<PopupPlacement>();
    const [sessions, setSessions] = useState<SessionSummary[]>();

    useEffect(() => {
        if (anchorRef.current) {
            setPlacement(popupPlacement(
                anchorRef.current.getBoundingClientRect(),
                { width: window.innerWidth, height: window.innerHeight },
                { width: LIST_WIDTH, maxHeight: LIST_MAX_HEIGHT },
            ));
        }
    }, [anchorRef]);

    useEffect(() => {
        let cancelled = false;
        listSessions(loopId).then(list => {
            if (!cancelled) setSessions(list);
        }).catch(err => {
            logger.error('Failed to list the conversations that were closed:', err);
            if (!cancelled) setSessions([]);
        });
        return () => {
            cancelled = true;
        };
    }, [loopId]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (!listRef.current?.contains(target) && !anchorRef.current?.contains(target)) {
                onClose();
            }
        };
        // Escape answers a list the way it answers a dialog: nothing was picked, and it goes away.
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        window.addEventListener('resize', onClose);
        window.addEventListener('scroll', onClose, true);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('resize', onClose);
            window.removeEventListener('scroll', onClose, true);
        };
    }, [anchorRef, onClose]);

    if (!placement) return null;

    return createPortal(
        <div
            ref={listRef}
            style={{
                position: 'fixed',
                top: placement.top,
                bottom: placement.bottom,
                left: placement.left,
                width: LIST_WIDTH,
                maxHeight: placement.maxHeight,
            }}
            className="z-50 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg"
        >
            {!sessions ? (
                <p className="px-3 py-4 text-center text-xs text-gray-400">
                    {t('web.pages.chat.session.loading')}
                </p>
            ) : !sessions.length ? (
                <p className="px-3 py-4 text-center text-xs text-gray-400">
                    {t('web.pages.chat.session.empty')}
                </p>
            ) : sessions.map(session => (
                <button
                    key={session.sessionId}
                    type="button"
                    onClick={() => onPick(session.sessionId)}
                    className="w-full border-b border-gray-100 px-3 py-2 text-left last:border-b-0
                        hover:bg-gray-50"
                >
                    <div className="flex items-center gap-2">
                        {/* What it was called, and lacking that when it was: one that ran before
                            conversations had names is still told apart by the time it was had. */}
                        <span className="flex-1 truncate text-xs font-medium text-gray-700">
                            {session.name || formatDate(i18n.language, startedAt(session))}
                        </span>
                        {session.sessionId === viewingSessionId &&
                            <Check size={14} className="shrink-0 text-cyan-600" />}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-gray-500 wrap-anywhere">
                        {session.finalText || t('web.pages.chat.session.noSummary')}
                    </p>
                    <p className="mt-1 text-[11px] text-gray-400">
                        {t('web.pages.chat.session.meta', {
                            date: formatDate(i18n.language, startedAt(session)),
                            turns: session.turnCount, tokens: formatCount(totalTokens(session)),
                        })}
                    </p>
                </button>
            ))}
        </div>,
        document.body
    );
}
