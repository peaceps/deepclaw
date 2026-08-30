'use client';

import { Check } from 'lucide-react';
import type { AgentEmployee } from '@deepclaw/core';
import { AnchoredPopup } from '@/laf/anchored-popup';
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
    /**
     * The word for picking nobody, where nobody is a thing to pick. A task is always somebody's to
     * work and is never offered this; a reviewer is what almost no task has, so taking one back off
     * has to be as easy as putting one on.
     */
    noneLabel?: string;
    anchorRef: React.RefObject<HTMLElement | null>;
    onPick: (agentId: string) => void;
    onClose: () => void;
};

/** The roster of a card, hung on the pencil that opened it. */
export function AssigneePicker(
    { agents, selectedId, noneLabel, anchorRef, onPick, onClose }: AssigneePickerProps
) {
    return (
        <AnchoredPopup
            anchorRef={anchorRef}
            width={LIST_WIDTH}
            maxHeight={LIST_MAX_HEIGHT}
            onClose={onClose}
        >
            {noneLabel && (
                <button
                    type="button"
                    onClick={() => onPick('')}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100"
                >
                    <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs text-gray-400">
                        —
                    </span>
                    <span className="flex-1 truncate text-gray-500">{noneLabel}</span>
                    {!selectedId && <Check size={14} className="shrink-0 text-cyan-600" />}
                </button>
            )}
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
        </AnchoredPopup>
    );
}
