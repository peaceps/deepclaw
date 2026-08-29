'use client';

import { CircleCheckBig, CirclePlay } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MissionStatus } from '@deepclaw/core';
import { AnchoredPopup } from '@/laf/anchored-popup';

/** Wide enough for the line under each word, which is where the consequence is spelled out. */
const LIST_WIDTH = 240;
const LIST_MAX_HEIGHT = 200;

type TaskStatusMenuProps = {
    status: MissionStatus;
    projectStarted: boolean;
    /** Closing a task set to pause is the verdict it was waiting for, which the word says. */
    paused: boolean;
    anchorRef: React.RefObject<HTMLElement | null>;
    onPick: (status: MissionStatus) => void;
    onClose: () => void;
};

/**
 * The one step a task can be moved on by hand, which is the step after the one it is on: a task in
 * todo is taken up and a task ongoing is closed. Backwards is not offered, the service refusing it
 * either way, and a task already done has nowhere left to go and opens no menu.
 *
 * Each word is written with what follows from it underneath. Both of these are steps a user cannot
 * undo and neither reads that way from the word alone: a task taken up cannot be handed on or put
 * back, closing one marks every step of it behind it and stands as the verification a pause on it
 * was waiting for, and where the project has not been started yet, taking a task up starts it.
 */
export function TaskStatusMenu(
    { status, projectStarted, paused, anchorRef, onPick, onClose }: TaskStatusMenuProps
) {
    const {t} = useTranslation();
    const next: MissionStatus = status === 'todo' ? 'ongoing' : 'done';
    const hint = next === 'ongoing'
        ? (projectStarted ? 'ongoingHint' : 'ongoingHintUnstarted')
        : (paused ? 'doneHintPaused' : 'doneHint');
    const Icon = next === 'ongoing' ? CirclePlay : CircleCheckBig;
    return (
        <AnchoredPopup
            anchorRef={anchorRef}
            width={LIST_WIDTH}
            maxHeight={LIST_MAX_HEIGHT}
            onClose={onClose}
        >
            <button
                type="button"
                onClick={() => onPick(next)}
                className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-gray-100"
            >
                <Icon size={14} className="mt-0.5 shrink-0 text-cyan-600" />
                <span className="min-w-0">
                    <span className="block text-sm text-gray-900">
                        {t(`web.pages.projects.task.status.${next}`)}
                    </span>
                    <span className="block text-xs text-gray-500">
                        {t(`web.pages.projects.task.status.${hint}`)}
                    </span>
                </span>
            </button>
        </AnchoredPopup>
    );
}
