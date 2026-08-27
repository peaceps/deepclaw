'use client';

import { useEffect, useRef, useState } from 'react';
import { getLogger } from '@/lib/logger';
import { getProjectDetail } from '@/server/data';
import { useAppStore } from './store';

const logger = getLogger('useProjectTasks');

/**
 * Asks for the tasks of the projects named and puts them in the projects the store holds.
 *
 * A page is handed every project with none of their tasks, those being almost all of a project by
 * weight and the one part of that list which grows with how many projects there are. So whatever
 * draws tasks says which projects it draws them of, and they arrive here. What lands is the whole
 * project, and every later word about it is the whole of it too, so once a project has been asked
 * about it keeps itself: the steps of a task walk on the screen without this being asked again.
 *
 * Asked once per project for as long as the caller is mounted, and again if it mounts anew, even
 * where the tasks are held already. Nothing about the held ones is known to be wrong -- they came
 * of an ask like this one or of an update, and an update carries the whole project -- but neither
 * is it known that nothing was missed. A stream that drops and comes back is told nothing of what
 * went out while it was away, and a card that wrote a change of its own before the server agreed
 * to it has been holding that change since. Opening a row is a hand's work and one request beside
 * that costs nothing, so a row is drawn from what the server says rather than from what survived.
 */
export function useProjectTasks(projectIds: string[]): {unread: boolean} {
    const updateProject = useAppStore(s => s.updateProject);
    const [failed, setFailed] = useState<string[]>([]);
    const asked = useRef<Set<string>>(new Set());
    // The ids as one string: the list is rebuilt out of the store on every update of any project,
    // and an array that is new each time would read as a new set of projects to ask about.
    const key = projectIds.join(',');

    useEffect(() => {
        for (const projectId of key.split(',').filter(Boolean)) {
            if (asked.current.has(projectId)) {
                continue;
            }
            asked.current.add(projectId);
            getProjectDetail(projectId).then(project => {
                updateProject(project);
                setFailed(ids => ids.includes(projectId) ? ids.filter(id => id !== projectId) : ids);
            }).catch(error => {
                logger.error(`Failed to read the tasks of ${projectId}:`, error);
                // Forgotten rather than remembered as asked, so a later run of this asks again.
                asked.current.delete(projectId);
                setFailed(ids => ids.includes(projectId) ? ids : [...ids, projectId]);
            });
        }
    }, [key, updateProject]);

    // Of the projects being asked about now and no others: what failed is remembered by project,
    // and a caller that has moved on to different ones is not waiting on any of it.
    return {unread: failed.some(projectId => projectIds.includes(projectId))};
}
