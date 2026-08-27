'use client';

import { useCallback, useState } from 'react';
import { Archive, FileText } from 'lucide-react';
import { splitLoopId, type SlimProject } from '@deepclaw/core';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/lib/store';
import { archiveProject } from '@/server/data';
import { ConfirmModal } from '@/laf/confirm-modal';
import { TaskOutput } from '@/laf/task-output';

/**
 * What can be done with the project as a whole, beneath the tasks it is made of: reading what it
 * came to, and putting it away.
 *
 * Under the tasks rather than up in the header of the row, which is one click target for folding the
 * row open and shut -- everything interactive in there has to catch the click before it reaches the
 * header, and a project is not a thing to put away by a stray click on a row. Having to open the
 * project first is the guard, and the confirm behind the button is the other one.
 */
export function ProjectActions({project}: {project: SlimProject}) {
    const getProjects = useAppStore(s => s.getProjects);
    const setProjects = useAppStore(s => s.setProjects);
    const updateProject = useAppStore(s => s.updateProject);
    // A run of this project is the one thing archiving cannot happen under: it would leave the run
    // coming back to a project the manager no longer has.
    const running = useAppStore(
        s => s.busyLoops.some(loopId => splitLoopId(loopId).projectId === project.id)
    );
    const [confirming, setConfirming] = useState(false);
    const {t} = useTranslation();

    const archive = useCallback(() => {
        setConfirming(false);
        // The whole list goes back if the call fails: the row leaves at once, and one project put
        // back on its own would land at the end of a list the board reads in order. The snapshot is
        // of the list as it stood before the call, so news of another project that arrived while the
        // call was out is undone along with it, and stays undone until something says it again. The
        // window is one request wide and only opens on a failed archive, which is what buys it.
        const previousProjects = getProjects();
        updateProject({id: project.id, archivedAt: new Date().toISOString()});
        archiveProject(project.id).catch(() => setProjects(previousProjects));
    }, [getProjects, project.id, setProjects, updateProject]);

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
            <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={running}
                title={t(`web.pages.projects.project.archive.${running ? 'running' : 'hint'}`)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                    text-red-500 border border-red-200 rounded-md transition-colors
                    ${running ? 'opacity-40 cursor-not-allowed' : 'hover:bg-red-50 cursor-pointer'}`}
            >
                <Archive size={14} />
                {t('web.pages.projects.project.archive.action')}
            </button>
            {confirming && <ConfirmModal
                title={t('web.pages.projects.project.archive.action')}
                message={t('web.pages.projects.project.archive.confirm', {title: project.title})}
                confirmLabel={t('web.pages.projects.project.archive.action')}
                onConfirm={archive}
                onCancel={() => setConfirming(false)}
            />}
        </div>
    );
}
