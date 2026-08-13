import { FileUtils } from '@deepclaw/node-utils';
import { addTokenUsage, type RunningTask } from '@deepclaw/core';
import { i18nInstance } from '@deepclaw/i18n';
import { AssignedTask, OneLoopContext } from '../../definitions/definitions';
import { ToolDesc } from '../../definitions/tool-definitions';
import { LoopAgent } from '../loop/loop';
import { ProjectManager } from '../services/project-manager';
import { RunningTaskService } from '../services/running-task-service';
import { SessionService } from '../services/session-service';

type SubLoopInput = {
    prompt: string;
    taskTitle?: string;
}

/** A run before it was started, the service is the one handing out the handle. */
type PlannedRun = Omit<RunningTask, 'runId'>;

/**
 * A picture only reaches the user when it is named in the answer of the loop that spawned the sub
 * loop. The summary of a sub loop is written by a model that may well drop a hash on the way, so
 * the references travel next to it instead of inside it.
 */
function withDrawnImages(text: string, refs: string[]): string {
    if (!refs.length) {
        return text;
    }
    return `${text}\n\n${i18nInstance.t('agent.tools.subLoop.drawnImages', {
        images: refs.map(ref => `![image](${ref})`).join('\n'),
    })}`;
}

/**
 * Only a run on a task is worth keeping: a sub loop without one belongs to nothing a board could
 * show it under. The status of the task cannot stand in for this, it is set before the handover
 * and stays on until the result was accepted.
 */
function startRun(run: PlannedRun | undefined, context: OneLoopContext): string | undefined {
    if (!run) {
        return undefined;
    }
    const runId = RunningTaskService.start(run);
    fireRunningTasksEvent(context);
    return runId;
}

function finishRun(runId: string | undefined, context: OneLoopContext): void {
    if (!runId) {
        return;
    }
    RunningTaskService.finish(runId);
    fireRunningTasksEvent(context);
}

function fireRunningTasksEvent(context: OneLoopContext): void {
    context.actions.agentHandler.onInfoEvent({
        eventType: 'updateRunningTasks',
        content: RunningTaskService.getRunningTasks(),
    });
}

/**
 * Refuses a task that cannot be found instead of running an unfocused sub loop for it. The task
 * always comes from the project of the session: memory, skills and the files of a sub loop are
 * scoped to the loop that spawned it, so a task of another project would be worked on with the
 * wrong ones around it. The run is filed under whoever the subagent stands for, which is the
 * assignee of the task wherever there is one: that is the page the run belongs on.
 */
function planRun(input: SubLoopInput, context: OneLoopContext): PlannedRun | undefined {
    if (!input.taskTitle) {
        return undefined;
    }
    // A cron loop keeps the id of its cron task where a project loop keeps its project.
    if (context.role === 'cron') {
        throw new Error('A cron run has no project to take a task from, work on the task yourself.');
    }
    const projectId = context.projectId;
    if (!projectId) {
        throw new Error('This session runs no project, only a project session can hand a task over.');
    }
    const task = ProjectManager.getTask(projectId, input.taskTitle);
    if (!task) {
        throw new Error(`Task "${input.taskTitle}" not found in project "${projectId}".`);
    }
    if (task.status === 'done') {
        throw new Error(`Task "${task.title}" is done, and a done task never goes back to ongoing.`);
    }
    if (RunningTaskService.isRunning(projectId, task.title)) {
        throw new Error(`A subagent is working on "${task.title}" already, wait for it to report back.`);
    }
    // Moving the step index is all a sub loop may do to its task, and that is refused while the
    // task is still todo. Waiting for the assigning loop to remember it would waste the run.
    if (task.status === 'todo') {
        ProjectManager.updateTask(projectId, {title: task.title, status: 'ongoing'});
        ProjectManager.fireProjectInfoEvent(projectId, context);
    }
    return {
        projectId,
        taskTitle: task.title,
        agentId: task.assignee || context.agentId,
        startedAt: new Date().toISOString(),
    };
}

export const subLoopTool: ToolDesc<SubLoopInput> = {
    tool: {
        name: 'sub_loop',
        description: `Spawn a subagent with fresh context. It shares the filesystem but not conversation history.
Name a task of the project of this session to let the subagent work on that task alone: it works as
the agent the task is assigned to, with the memory and the skills of that agent, and gets the
description and the steps of the task in its prompt.
Nothing the subagent says reaches the user, only what you write down out of what it hands back.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                prompt: {type: 'string', description: 'The task prompt for the sub-agent'},
                taskTitle: {
                    type: 'string',
                    description: 'The title of the task of this project the sub-agent has to work on.',
                },
            },
            required: ['prompt']}
    },
    agentMode: ['agent'],
    parallelSafe: true,
    exclusiveInSubLoop: true,
    invoke: async function(input: SubLoopInput, context: OneLoopContext): Promise<string> {
        const run = planRun(input, context);
        const assignedTask: AssignedTask | undefined =
            run && {projectId: run.projectId, taskTitle: run.taskTitle};
        const subLoop = context.actions.newSubLoop(assignedTask) as LoopAgent<any, any, any>;
        const runId = startRun(run, context);
        try {
            const result = await subLoop.invoke(input.prompt, { browserId: context.browserId });
            // The sub loop keeps no session of its own, so its tokens are only ever counted here.
            addTokenUsage(context.runtime.usage, result.runtime.usage);
            return withDrawnImages(result.text, subLoop.getDrawnImages());
        } finally {
            finishRun(runId, context);
            const sessionDir = subLoop.getSessionDir();
            FileUtils.deleteDir(sessionDir);
            SessionService.dropSession(sessionDir);
        }
    },
}
