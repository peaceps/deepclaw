import { FileUtils } from '@deepclaw/node-utils';
import { FlushAgentRole } from '@deepclaw/core';
import { AssignedTask, OneLoopContext } from '../definitions/definitions';
import { ProjectManager } from './services/project-manager';

/**
 * The folder the project of this run works in, and nothing where that is the data root.
 *
 * Asked of the ids rather than of a run, because the prompt of a run is built before there is one:
 * what the run is told it is working in and what it then works in have to be the same folder, and
 * two answers to that question is the one way this could mislead a model outright.
 *
 * A run works on the project it was pointed at rather than the one it was started for: a task loop
 * and the sub loops under it carry the project of the task, and all of them work where that project
 * works. A scheduled run carries the id of a cron task in the same field and no project at all, so
 * it is named here: asked for a project by that id the manager would answer with none anyway, and
 * saying so out loud keeps the next reader from taking this for an oversight.
 */
export function projectWorkDir(
    role: FlushAgentRole, projectId: string, assignedTask?: AssignedTask
): string | undefined {
    if (role === 'cron') {
        return undefined;
    }
    const id = assignedTask?.projectId || projectId;
    return id ? ProjectManager.workingDirOf(id) : undefined;
}

/**
 * Where this run works, which is the data root for every run whose project named no folder of its
 * own -- and that is where everything of deepclaw has always been read and written.
 *
 * One question with one answer, asked by everything of a run that touches the filesystem: the
 * folder its commands start in, the folder a name it writes is read against, and the folder it may
 * reach into without anybody being asked. Answered anywhere else as well, the three would drift
 * apart the day one of them changed, and a run whose commands land in one folder while its writes
 * land in another is a run nobody can reason about.
 */
export function runWorkingDir(context: OneLoopContext): string {
    return projectWorkDir(context.role, context.projectId, context.assignedTask)
        ?? FileUtils.getWorkingDir();
}

/**
 * The file a name of this run means. A relative one is read against the folder the run works in,
 * which is the folder its own commands started in: told it is working in a repository and then
 * writing a name that lands beside the data instead is the one way a working dir could be worse
 * than never having had one.
 */
export function runPath(context: OneLoopContext, filePath: string): string {
    return FileUtils.getAbsolutePath(filePath, runWorkingDir(context));
}

/**
 * Whether a path is one this run may reach without asking: the data root, the temporaries, and the
 * folder its project works in. That last one is the whole point of naming a folder -- a repository
 * outside the data root is exactly what the guard would otherwise stop at, and whoever named that
 * folder for this project has already said the work belongs in there.
 *
 * Asked of the path as this run reads it, so a relative name is asked after where it would land.
 */
export function inRunWorkspace(context: OneLoopContext, filePath: string): boolean {
    const target = runPath(context, filePath);
    return FileUtils.isPathInWorkspace(target)
        || FileUtils.isPathInside(runWorkingDir(context), target);
}
