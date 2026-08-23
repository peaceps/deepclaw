'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import type { AgentEmployee } from '@deepclaw/core';
import { avatarBG } from '../styles-mapping';

type AssigneePickerProps = {
    agents: AgentEmployee[];
    selectedId?: string;
    anchorRef: React.RefObject<HTMLElement | null>;
    onPick: (agentId: string) => void;
    onClose: () => void;
};

/**
 * The roster of a card, hung under the pencil that opened it. It goes in a portal because a card
 * sits in a column that scrolls its own way, and a list drawn inside one would be cut off by it.
 */
export function AssigneePicker({ agents, selectedId, anchorRef, onPick, onClose }: AssigneePickerProps) {
    const listRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<{ top: number; left: number }>();

    useEffect(() => {
        if (anchorRef.current) {
            const rect = anchorRef.current.getBoundingClientRect();
            setPosition({ top: rect.bottom + 4, left: rect.left });
        }
    }, [anchorRef]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (!listRef.current?.contains(target) && !anchorRef.current?.contains(target)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('resize', onClose);
        window.addEventListener('scroll', onClose, true);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('resize', onClose);
            window.removeEventListener('scroll', onClose, true);
        };
    }, [anchorRef, onClose]);

    if (!position) return null;

    return createPortal(
        <div
            ref={listRef}
            style={{ position: 'fixed', top: position.top, left: position.left }}
            className="z-50 min-w-[10rem] max-h-60 overflow-auto rounded-md border border-gray-200
                bg-white shadow-lg"
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
