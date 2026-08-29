'use client';

import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MISSION_PRIORITIES, type MissionPriority } from '@deepclaw/core';
import { AnchoredPopup } from '@/laf/anchored-popup';
import { priorityStyles } from '../styles-mapping';

/** Four short words, so the list is drawn to the pill rather than to the longest of them. */
const LIST_WIDTH = 130;
const LIST_MAX_HEIGHT = 200;

/**
 * Loudest first, which is the way round a person reads a list of these and the opposite of the way
 * the priorities are kept: a schema hands its order to a model as a nudge, and a plan should not
 * come out urgent because urgent was typed first.
 */
const OFFERED_PRIORITIES = [...MISSION_PRIORITIES].reverse();

type PriorityPickerProps = {
    selected: MissionPriority;
    anchorRef: React.RefObject<HTMLElement | null>;
    onPick: (priority: MissionPriority) => void;
    onClose: () => void;
};

/**
 * The four priorities, hung on the pill that opened them and each drawn as the pill it would put
 * on the card: what a card looks like after the pick is the thing being picked between.
 */
export function PriorityPicker({ selected, anchorRef, onPick, onClose }: PriorityPickerProps) {
    const {t} = useTranslation();
    return (
        <AnchoredPopup
            anchorRef={anchorRef}
            width={LIST_WIDTH}
            maxHeight={LIST_MAX_HEIGHT}
            onClose={onClose}
        >
            {OFFERED_PRIORITIES.map(priority => (
                <button
                    key={priority}
                    type="button"
                    onClick={() => onPick(priority)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100"
                >
                    <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${priorityStyles[priority]}`}>
                        {t(`web.common.priority.${priority}`)}
                    </span>
                    <span className="flex-1"></span>
                    {priority === selected && <Check size={14} className="shrink-0 text-cyan-600" />}
                </button>
            ))}
        </AnchoredPopup>
    );
}
