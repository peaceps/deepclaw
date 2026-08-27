'use client';

import { useEffect, useRef, useState } from 'react';
import type { SlimProject } from '@deepclaw/core';
import { getLogger } from '@/lib/logger';
import { getProjectDetail } from '@/server/data';
import { useAppStore } from './store';

const logger = getLogger('useProjectTasks');

/**
 * Of the projects named, the ones whose tasks are not in hand, as one string.
 *
 * As one string because this is read again on every change to anything the store holds, and it has
 * to answer in something that compares by value: the ids as an array would be a new array each
 * time and would set the asking off at that rate. A project holding an empty set of tasks has been
 * answered about and is not among these -- some projects have no tasks -- while one the store has
 * never heard of is, that being what the agent page asks about, of projects no row is drawn from.
 */
export function idsWantingTasks(
    projects: Pick<SlimProject, 'id' | 'tasks'>[], projectIds: string[]
): string {
    return projectIds
        .filter(projectId => !projects.find(project => project.id === projectId)?.tasks)
        .join(',');
}

/**
 * What is to become of an answer that has landed.
 *
 * `write` puts it in the store. `drop` does not, the project it speaks of having left the list
 * since it was asked about, but the ask is this run's and is over. `ignore` touches nothing at
 * all: the answer belongs to a run that has ended, and so do the asks counted as being in the air.
 */
export type AnswerLanding = 'write' | 'drop' | 'ignore';

/**
 * Whether an answer still speaks of the page it was asked of.
 *
 * The count of whole replacements is the run an ask belongs to: one asked before the whole list
 * was put there anew is answered about the list that is gone, which is a state older than an
 * outage by everything that happened during it. Such an answer is dropped and asked for again,
 * both being requests of their own with no order between them, and the ids of that run go with it.
 *
 * A project the store had at the asking and has no longer was put away while this was out, and the
 * answer was read while it was still there, so it carries no sign of that: written, it would put
 * the row back on a board with nothing left to take it off again, the news that would have taken
 * it off having already been and gone. One the store never had is another matter, and is written.
 */
export function landingOfAnswer(answer: {
    epochAtAsk: number; epochNow: number; knownAtAsk: boolean; knownNow: boolean;
}): AnswerLanding {
    if (answer.epochNow !== answer.epochAtAsk) {
        return 'ignore';
    }
    return answer.knownAtAsk && !answer.knownNow ? 'drop' : 'write';
}

/**
 * Asks for the tasks of the projects named and puts them in the projects the store holds.
 *
 * A page is handed every project with none of their tasks, those being almost all of a project by
 * weight and the one part of that list which grows with how many projects there are. So whatever
 * draws tasks says which projects it draws them of, and they arrive here. What lands is the whole
 * project, and every later word about it is the whole of it too, so once a project has been asked
 * about it keeps itself: the steps of a task walk on the screen without this being asked again.
 *
 * Asked for only where the tasks are not held already, and what is held is read off the store
 * rather than remembered here: a row opened a second time, or a project still on the agent page
 * from the run before, draws what is there. Nor is what is there suspected of being behind -- a
 * project arrives whole or not at all, so there is no such thing as half of one -- save where a
 * stream died without the browser noticing, which is left to be dealt with where streams are.
 *
 * Reading the want off the store rather than keeping a list of what was asked is also most of what
 * answers the whole list being replaced at once, as it is when a stream comes back: that list
 * carries no tasks in any project, so everything on screen goes back to wanting them and is asked
 * again. What it does not answer is an ask that was already in the air at that moment, or one
 * whose project has been put away since it was made; those are told apart where an answer lands,
 * by the count of replacements and the list as it then stands, and are said above.
 */
export function useProjectTasks(projectIds: string[]): {unread: boolean} {
    const updateProject = useAppStore(s => s.updateProject);
    const getProjects = useAppStore(s => s.getProjects);
    const getDataEpoch = useAppStore(s => s.getDataEpoch);
    const dataEpoch = useAppStore(s => s.dataEpoch);
    const [failed, setFailed] = useState<string[]>([]);
    // The asks in the air, so that a caller naming its projects again before an answer lands does
    // not ask twice, kept under the count they were asked at: a replacement of the whole leaves
    // them all unanswerable at once, and the set is dropped whole rather than emptied by id.
    const inFlight = useRef<{epoch: number; ids: Set<string>}>({epoch: dataEpoch, ids: new Set()});
    const wanted = useAppStore(s => idsWantingTasks(s.projects, projectIds));

    useEffect(() => {
        const epochAtAsk = dataEpoch;
        if (inFlight.current.epoch !== epochAtAsk) {
            inFlight.current = {epoch: epochAtAsk, ids: new Set()};
        }
        for (const projectId of wanted.split(',').filter(Boolean)) {
            if (inFlight.current.ids.has(projectId)) {
                continue;
            }
            inFlight.current.ids.add(projectId);
            const knownAtAsk = getProjects().some(project => project.id === projectId);
            getProjectDetail(projectId).then(project => {
                // Both counts as they stand, not as the ref above has them: that one only moves on
                // when an effect runs, so between the count going up and React getting there it
                // still says what it said, and an answer let through in that moment is one nothing
                // asks again -- it fills the tasks in, and a project holding tasks is asked
                // nothing.
                const landing = landingOfAnswer({
                    epochAtAsk,
                    epochNow: getDataEpoch(),
                    knownAtAsk,
                    knownNow: getProjects().some(project => project.id === projectId),
                });
                if (landing === 'ignore') return;
                inFlight.current.ids.delete(projectId);
                if (landing === 'drop') return;
                updateProject(project);
                setFailed(ids => ids.includes(projectId) ? ids.filter(id => id !== projectId) : ids);
            }).catch(error => {
                logger.error(`Failed to read the tasks of ${projectId}:`, error);
                if (getDataEpoch() !== epochAtAsk) return;
                // Nothing landed, so the project is still wanting and a later run asks again.
                inFlight.current.ids.delete(projectId);
                setFailed(ids => ids.includes(projectId) ? ids : [...ids, projectId]);
            });
        }
    }, [wanted, dataEpoch, getProjects, getDataEpoch, updateProject]);

    // Of the projects being asked about now and no others: what failed is remembered by project,
    // and a caller that has moved on to different ones is not waiting on any of it.
    return {unread: failed.some(projectId => projectIds.includes(projectId))};
}
