'use client';

import { useCallback, useState } from 'react';
import { Archive, FileText, Play } from 'lucide-react';
import {
    getLoopId, isProjectStarted, newMessage, splitLoopId, type SlimProject
} from '@deepclaw/core';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/lib/store';
import { useToastStore } from '@/lib/toast-store';
import { archiveProject, startProject } from '@/server/data';
import { invoke, pushChatMessage } from '@/server/loop-agent';
import { getLogger } from '@/lib/logger';
import { ConfirmModal } from '@/laf/confirm-modal';
import { TaskOutput } from '@/laf/task-output';

const logger = getLogger('ProjectActions');

/**
 * What can be done with the project as a whole, beneath the tasks it is made of: setting the work
 * going, reading what it came to, and putting it away.
 *
 * Under the tasks rather than up in the header of the row, which is one click target for folding the
 * row open and shut -- everything interactive in there has to catch the click before it reaches the
 * header, and a project is not a thing to put away by a stray click on a row. Having to open the
 * project first is the guard, and the confirm behind the button is the other one.
 *
 * Starting the work wants both of those as much as archiving does. What is being agreed to is the
 * plan above the button, so it is read before it is started; and the button is there to hold the
 * work until the user says a word, which a stray click would say for them. Nothing takes it back:
 * the tasks that go out are out.
 */
export function ProjectActions({project}: {project: SlimProject}) {
    const loopId = getLoopId('project', project.creator, project.id);
    const browserId = useAppStore(s => s.browserId);
    const getProjects = useAppStore(s => s.getProjects);
    const setProjects = useAppStore(s => s.setProjects);
    const updateProject = useAppStore(s => s.updateProject);
    const addMessage = useAppStore(s => s.addMessage);
    const setChatBusy = useAppStore(s => s.setChatBusy);
    // Whether the conversation of this project is one this tab has open, which is what says a
    // message put into it locally would be read as one of many rather than as the whole of it.
    const chatHeld = useAppStore(s => !!s.messages[loopId]);
    const showToast = useToastStore(s => s.show);
    // A run of this project is the one thing archiving cannot happen under: it would leave the run
    // coming back to a project the manager no longer has. Starting waits on it for a milder reason:
    // the word that starts the work would be answered with the hint to wait its turn.
    const running = useAppStore(
        s => s.busyLoops.some(loopId => splitLoopId(loopId).projectId === project.id)
    );
    // Which of the two questions is being asked, there being no asking both at once.
    const [confirming, setConfirming] = useState<'start' | 'archive' | null>(null);
    const {t} = useTranslation();

    const archive = useCallback(() => {
        setConfirming(null);
        // The whole list goes back if the call fails: the row leaves at once, and one project put
        // back on its own would land at the end of a list the board reads in order. The snapshot is
        // of the list as it stood before the call, so news of another project that arrived while the
        // call was out is undone along with it, and stays undone until something says it again. The
        // window is one request wide and only opens on a failed archive, which is what buys it.
        const previousProjects = getProjects();
        updateProject({id: project.id, archivedAt: new Date().toISOString()});
        archiveProject(project.id).catch(() => setProjects(previousProjects));
    }, [getProjects, project.id, setProjects, updateProject]);

    /**
     * The date first and the run after, in that order and never together: the run reads the board
     * on its way in, and one started before the date was written would be told the project it is
     * being asked to start has not been started.
     *
     * What is sent is a message of the user's like any other, written into the conversation of the
     * project as though they had typed it. The agent is given the words the user reads back, so the
     * answer that follows has something above it to answer -- an agent that begins handing out work
     * of its own accord is the whole of what this button is here to end.
     */
    const start = useCallback(async () => {
        setConfirming(null);
        updateProject({id: project.id, startedAt: new Date().toISOString()});
        setChatBusy(loopId, true);
        try {
            await startProject(project.id);
        } catch (error) {
            // The row goes back to holding the button, which on its own reads as a click that
            // missed. Said out loud instead: the word did not get through and theirs is still the
            // one the project is waiting on.
            logger.error(`Failed to start the work on ${project.id}: ${error}`);
            updateProject({id: project.id, startedAt: null});
            setChatBusy(loopId, false);
            showToast({type: 'error', message: t('web.pages.projects.project.start.failed')});
            return;
        }
        const text = t('web.pages.projects.project.start.kickoff');
        const message = newMessage('user', project.creator, text);
        // Only put in front of a conversation this tab has open. Opening one later asks the server
        // for what came after the newest message held, and a chat holding this one alone would ask
        // for what came after the last thing said: the talk that settled the plan is older than it.
        if (chatHeld) {
            addMessage(loopId, message);
        }
        pushChatMessage(browserId, loopId, message);
        try {
            // Said to a loop with a run already in it, the word to begin is answered with the hint
            // to wait its turn and nothing hands a task out. The project is started either way --
            // the user said so -- so what is left to say is who the word is still waiting on.
            const {busy} = await invoke(browserId, 'project', project.creator, project.id, text);
            if (busy) {
                showToast({type: 'warning', message: t('web.pages.projects.project.start.busy')});
            }
        } catch (error) {
            logger.error(`Failed to invoke ${loopId}: ${error}`);
            setChatBusy(loopId, false);
            showToast({type: 'error', message: t('web.pages.projects.project.start.error')});
        }
    }, [
        addMessage, browserId, chatHeld, loopId, project.creator, project.id, setChatBusy,
        showToast, t, updateProject
    ]);

    return (
        <div className="w-full flex items-center justify-end gap-3 border-t border-gray-200
          bg-gray-50 px-4 py-2">
            {project.output && <TaskOutput
                output={project.output}
                title={project.title}
                modalTitle={t('web.pages.projects.project.report')}
                label={t('web.pages.projects.project.report')}
                icon={<FileText size={14} />}
            />}
            {/* Gone for good once the work is on: it is the one word the user gives a project, and
                a project already under way has nothing to do with it. */}
            {!isProjectStarted(project) && <button
                type="button"
                onClick={() => setConfirming('start')}
                disabled={running}
                title={t(`web.pages.projects.project.start.${running ? 'running' : 'hint'}`)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                    text-emerald-600 border border-emerald-200 rounded-md transition-colors
                    ${running ? 'opacity-40 cursor-not-allowed' : 'hover:bg-emerald-50'}`}
            >
                <Play size={14} />
                {t('web.pages.projects.project.start.action')}
            </button>}
            <button
                type="button"
                onClick={() => setConfirming('archive')}
                disabled={running}
                title={t(`web.pages.projects.project.archive.${running ? 'running' : 'hint'}`)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                    text-red-500 border border-red-200 rounded-md transition-colors
                    ${running ? 'opacity-40 cursor-not-allowed' : 'hover:bg-red-50'}`}
            >
                <Archive size={14} />
                {t('web.pages.projects.project.archive.action')}
            </button>
            {confirming && <ConfirmModal
                title={t(`web.pages.projects.project.${confirming}.action`)}
                message={t(`web.pages.projects.project.${confirming}.confirm`, {title: project.title})}
                confirmLabel={t(`web.pages.projects.project.${confirming}.action`)}
                tone={confirming === 'start' ? 'go' : 'danger'}
                onConfirm={confirming === 'start' ? start : archive}
                onCancel={() => setConfirming(null)}
            />}
        </div>
    );
}
