import { FileUtils } from '@deepclaw/node-utils';
import { addTokenUsage, type RunningTask } from '@deepclaw/core';
import { i18nInstance } from '@deepclaw/i18n';
import { OneLoopContext } from '../../definitions/definitions';
import { ToolDesc } from '../../definitions/tool-definitions';
import { LoopAgent } from '../loop/loop';
import { ProjectManager } from '../services/project-manager';
import { RunningTaskService } from '../services/running-task-service';
import { SessionService } from '../services/session-service';

const MAX_PARALLEL_TASK_LOOPS = 3;

type TaskLoopInput = {
    prompt: string;
    taskId: string;
}

type SubLoopInput = {
    prompt: string;
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
 * Runs a loop that was spawned for this one call and takes its run apart afterwards. Its session
 * was never meant to outlive the answer, and its tokens are only ever counted here: nothing of it
 * is written where a session is kept.
 */
async function runSpawnedLoop(
    loop: LoopAgent<any, any, any>, prompt: string, context: OneLoopContext
): Promise<string> {
    try {
        // The signal travels down rather than the reason: a stop is set as a flag on the loop it
        // was addressed to, and the loops below it are reached this way and no other. It recurses
        // of its own accord, since a sub loop hands the very same signal to whatever it spawns.
        const result = await loop.invoke(prompt, {
            browserId: context.browserId, abortSignal: context.abortSignal
        });
        addTokenUsage(context.runtime.usage, result.runtime.usage);
        return withDrawnImages(result.text, loop.getDrawnImages());
    } finally {
        const sessionDir = loop.getSessionDir();
        FileUtils.deleteDir(sessionDir);
        SessionService.dropSession(sessionDir);
    }
}

/**
 * Only a run on a task is worth keeping: a sub loop without one belongs to nothing a board could
 * show it under. The status of the task cannot stand in for this, it is set before the handover
 * and stays on until the result was accepted.
 */
function startRun(run: PlannedRun, context: OneLoopContext): string {
    const runId = RunningTaskService.start(run);
    fireRunningTasksEvent(context);
    return runId;
}

function finishRun(runId: string, context: OneLoopContext): void {
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
 * Refuses a task that cannot be found instead of running an unfocused loop for it. The task always
 * comes from the project of the session: memory, skills and the files of a spawned loop are scoped
 * to the loop that spawned it, so a task of another project would be worked on with the wrong ones
 * around it. The run is filed under whoever the subagent stands for, which is the assignee of the
 * task wherever there is one: that is the page the run belongs on.
 */
function planRun(input: TaskLoopInput, context: OneLoopContext): PlannedRun {
    if (!input.taskId) {
        throw new Error('Name the task of this project the subagent has to work on.');
    }
    // Not an ordinary chat reaching for this: those are not handed the tool at all. What is left is
    // a run that calls itself a project run and names no project, which every entry point of ours
    // refuses to build but a loop id from outside can still ask for, "project.a1" being a loop id
    // like any other.
    const projectId = context.projectId;
    if (!projectId) {
        throw new Error('This session runs no project, only a project session can hand a task over.');
    }
    const task = ProjectManager.getTask(projectId, input.taskId);
    if (!task) {
        throw new Error(`Task "${input.taskId}" not found in project "${projectId}".`);
    }
    if (task.status === 'done') {
        throw new Error(`Task "${task.title}" is done, and a done task never goes back to ongoing.`);
    }
    if (RunningTaskService.isRunning(projectId, task.id)) {
        throw new Error(`A subagent is working on "${task.title}" already, wait for it to report back.`);
    }
    // Moving the step index is all a task loop may do to its task, and that is refused while the
    // task is still todo. Waiting for the assigning loop to remember it would waste the run.
    if (task.status === 'todo') {
        ProjectManager.updateTask(projectId, {id: task.id, status: 'ongoing'});
        ProjectManager.fireProjectInfoEvent(projectId, context);
    }
    return {
        projectId,
        taskId: task.id,
        agentId: task.assignee || context.agentId,
        startedAt: new Date().toISOString(),
    };
}

export const taskLoopTool: ToolDesc<TaskLoopInput> = {
    tool: {
        name: 'task_loop',
        description: `Hand one task of this project to a subagent, the way every task of a project is
worked on. The subagent starts with fresh context: it shares the filesystem but not the conversation.
It works as the agent the task is assigned to, with the memory and the skills of that agent, and gets
the description and the steps of the task in its prompt. It can split the task among subagents of its
own, so hand the whole task over rather than a piece of it.
Tasks that block nothing and wait for nothing go out at the same time, one call each.
Nothing the subagent says reaches the user, only what you write down out of what it hands back. The
one thing of it they do see is a question it puts to them, which is asked in this conversation.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                prompt: {
                    type: 'string',
                    description: `What the subagent has to know beyond the task itself. It can ask
the user where only they can settle something, but its work stands still until they answer, so
everything you already know it needs goes in here rather than into a question.`,
                },
                taskId: {
                    type: 'string',
                    description: 'The id of the task of this project the subagent has to work on.',
                },
            },
            required: ['prompt', 'taskId']}
    },
    agentMode: ['agent'],
    parallelSafe: true,
    // A task loop splits its task among subagents of its own, so every call of this stands for a
    // whole tree of runs rather than a single one. Handing out more tasks at once buys little and
    // pays for it in runs that all wait on the same machine.
    maxParallel: MAX_PARALLEL_TASK_LOOPS,
    // The board of a project belongs to the loop that runs it: a subagent works a task it was
    // handed, it does not hand the tasks of the project out.
    loopKinds: ['main'],
    // A board to take a task from is what a project run has and no other run does: a scheduled run
    // keeps the id of its cron task in the same place, and an ordinary chat is started with no
    // project at all. Kept from them here rather than refused on the way in: a run never told of
    // the tool never spends a turn on it. This names the roles that get it rather than the one that
    // does not, so a role added later starts outside and has to be let in here on purpose.
    roles: ['project'],
    invoke: async function(input: TaskLoopInput, context: OneLoopContext): Promise<string> {
        const run = planRun(input, context);
        const taskLoop = context.actions.newTaskLoop({
            projectId: run.projectId, taskId: run.taskId,
        }) as LoopAgent<any, any, any>;
        const runId = startRun(run, context);
        try {
            return await runSpawnedLoop(taskLoop, input.prompt, context);
        } finally {
            finishRun(runId, context);
        }
    },
}

export const subLoopTool: ToolDesc<SubLoopInput> = {
    tool: {
        name: 'sub_loop',
        description: `Spawn a subagent with fresh context for one piece of work. It shares the
filesystem but not the conversation history.
A subagent of a subagent spawns nothing further, so give it work that stands on its own, and give out
work that waits for nothing at the same time, one call each.
Use task_loop for a task of the project: that is what the tasks on the board are worked on with.
Nothing the subagent says reaches the user, only what you write down out of what it hands back. The
one thing of it they do see is a question it puts to them, which is asked in this conversation.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                prompt: {
                    type: 'string',
                    description: `The work the subagent has to do, whole: it starts with nothing of
this conversation. It can ask the user where only they can settle something, and waits where it
asked, so what you already know belongs in here rather than in a question.`,
                },
            },
            required: ['prompt']}
    },
    agentMode: ['agent'],
    parallelSafe: true,
    // A sub loop is the end of the chain, otherwise a run could go on spawning runs forever.
    loopKinds: ['main', 'task'],
    invoke: async function(input: SubLoopInput, context: OneLoopContext): Promise<string> {
        const subLoop = context.actions.newSubLoop() as LoopAgent<any, any, any>;
        return runSpawnedLoop(subLoop, input.prompt, context);
    },
}
