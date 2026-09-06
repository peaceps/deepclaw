'use client';

import { CircleCheckBig, CirclePlay, CircleSlash, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NEXT_TASK_STATUSES, type TaskStatus } from '@deepclaw/core';
import { AnchoredPopup } from '@/laf/anchored-popup';

/** Wide enough for the line under each word, which is where the consequence is spelled out. */
const LIST_WIDTH = 240;
const LIST_MAX_HEIGHT = 200;

/** What the user is told they are about to do, which depends on where the task stands. */
type StepContext = {projectStarted: boolean; paused: boolean};

type Step = {
    Icon: LucideIcon;
    /** The icon is drawn in, work going on being the board's one colour and dropping it none. */
    colour: string;
    hint: (context: StepContext) => string;
};

/**
 * How each step a task can be moved by is drawn. A table over every word there is rather than over
 * the ones a menu offers: a status added to the union arrives here as a missing key, which is the
 * compiler asking for the icon and the line. Nothing leads back to todo, and the null says so.
 */
const STEPS: Record<TaskStatus, Step | null> = {
    todo: null,
    ongoing: {
        Icon: CirclePlay,
        colour: 'text-cyan-600',
        hint: ({projectStarted}) => projectStarted ? 'ongoingHint' : 'ongoingHintUnstarted',
    },
    done: {
        Icon: CircleCheckBig,
        colour: 'text-cyan-600',
        hint: ({paused}) => paused ? 'doneHintPaused' : 'doneHint',
    },
    obsolete: {
        Icon: CircleSlash,
        colour: 'text-gray-400',
        hint: () => 'obsoleteHint',
    },
};

type TaskStatusMenuProps = {
    status: TaskStatus;
    projectStarted: boolean;
    /** Closing a task set to pause is the verdict it was waiting for, which the word says. */
    paused: boolean;
    anchorRef: React.RefObject<HTMLElement | null>;
    onPick: (status: TaskStatus) => void;
    onClose: () => void;
};

/**
 * Where a task can be moved to by hand, read off the one table the service writes a status by: the
 * step after the one it is on, and dropping it as no longer worth doing. Backwards is not offered
 * and neither is a step over one, the service refusing both, and a task that is closed either way
 * has nowhere left to go and opens no menu.
 *
 * Each word is written with what follows from it underneath. None of these is a step a user can
 * undo and none of them reads that way from the word alone: a task taken up cannot be handed on or
 * put back, closing one marks every step of it behind it and stands as the verification a pause on
 * it was waiting for, dropping one closes it for good, and where the project has not been started
 * yet, taking a task up starts it.
 */
export function TaskStatusMenu(
    { status, projectStarted, paused, anchorRef, onPick, onClose }: TaskStatusMenuProps
) {
    const {t} = useTranslation();
    return (
        <AnchoredPopup
            anchorRef={anchorRef}
            width={LIST_WIDTH}
            maxHeight={LIST_MAX_HEIGHT}
            onClose={onClose}
        >
            {NEXT_TASK_STATUSES[status].map(next => {
                const step = STEPS[next];
                if (!step) {
                    return null;
                }
                const {Icon} = step;
                return (
                    <button
                        key={next}
                        type="button"
                        onClick={() => onPick(next)}
                        className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-gray-100"
                    >
                        <Icon size={14} className={`mt-0.5 shrink-0 ${step.colour}`} />
                        <span className="min-w-0">
                            <span className="block text-sm text-gray-900">
                                {t(`web.pages.projects.task.status.${next}`)}
                            </span>
                            <span className="block text-xs text-gray-500">
                                {t(`web.pages.projects.task.status.${
                                    step.hint({projectStarted, paused})}`)}
                            </span>
                        </span>
                    </button>
                );
            })}
        </AnchoredPopup>
    );
}
