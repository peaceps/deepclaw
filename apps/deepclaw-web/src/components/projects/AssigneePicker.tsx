'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import type { AgentEmployee } from '@deepclaw/core';
import { popupPlacement, type PopupPlacement } from '@/laf/popup-placement';
import { avatarBG } from '../styles-mapping';

/**
 * What the list asks for: the width it is drawn at, which is the width it is kept inside the page
 * by, and the most of it worth scrolling through. A long name is cut rather than allowed to widen
 * the list past what it was placed by.
 */
const LIST_WIDTH = 160;
const LIST_MAX_HEIGHT = 240;

type AssigneePickerProps = {
    agents: AgentEmployee[];
    selectedId?: string;
    anchorRef: React.RefObject<HTMLElement | null>;
    onPick: (agentId: string) => void;
    onClose: () => void;
};

/**
 * The roster of a card, hung on the pencil that opened it, under it or above it by whichever side
 * of the pencil the page has room on. It goes in a portal because a card sits in a column that
 * scrolls its own way, and a list drawn inside one would be cut off by it.
 */
export function AssigneePicker({ agents, selectedId, anchorRef, onPick, onClose }: AssigneePickerProps) {
    const listRef = useRef<HTMLDivElement>(null);
    const [placement, setPlacement] = useState<PopupPlacement>();

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
            {agents.map(agent => (
                <button
                    key={agent.id}
                    type="button"
                    onClick={() => onPick(agent.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100"
                >
                    <span className={`w-6 h-6 rounded-full ${avatarBG} flex items-center justify-center text-xs`}>
                        {agent.avatar}
                    </span>
                    <span className="flex-1 truncate text-gray-700">{agent.name}</span>
                    {agent.id === selectedId && <Check size={14} className="shrink-0 text-cyan-600" />}
                </button>
            ))}
        </div>,
        document.body
    );
}
