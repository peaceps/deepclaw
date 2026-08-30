import { FileUtils } from '@deepclaw/node-utils';
import { addTokenUsage, type AgentRuntime, isProjectStarted, type RunningTask } from '@deepclaw/core';
import { i18nInstance } from '@deepclaw/i18n';
import { FootPrint, isSpawnedLoop, OneLoopContext } from '../../definitions/definitions';
import { ToolDesc } from '../../definitions/tool-definitions';
import { LoopAgent } from '../loop/loop';
import { ProjectManager } from '../services/project-manager';
import { fireRunningTasksEvent, RunningTaskService } from '../services/running-task-service';
import { SessionService } from '../services/session-service';

const MAX_PARALLEL_TASK_LOOPS = 3;

/**
 * How much of a stopped run's account is worth the tokens. The last steps rather than the first:
 * what the loop above has to decide is where to pick the work up, and the run had got furthest at
 * the end. A step is a path or a command line, and one long enough to need cutting is a command
 * with a here document in it, whose first line names the tool that ran and the file it wrote to.
 *
 * The last of a run that spawned subagents is the last to come back rather than the last to
 * happen: three of them work side by side and each hands its whole list over at once, so the one
 * that finished last is read as the one that worked last. Cutting the newest of them for an even
 * share of each would be a truer picture of the tree and a worse answer to the question, which is
 * where the work stands now: what one subagent did to a file the next one is still working in is
 * of no use halfway.
 */
const MAX_TRACE_STEPS = 20;
const MAX_TRACE_STEP_LENGTH = 120;

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
 * What the subagent changed before it stopped, which nothing else of the run can say. What comes
 * back otherwise is one line -- the endpoint refused, the model would not answer, the turns ran
 * out, something threw -- and the session holding every turn behind that line is deleted a moment
 * later, so a loop above reading only the line cannot tell a run that wrote half the files from
 * one that never started.
 *
 * Written under whatever that line was rather than in place of it: the line says what went wrong
 * and this says what is left of the work, and the loop above needs the two together.
 */
function appendChanges(text: string, changes: FootPrint[]): string {
    if (!changes.length) {
        return text;
    }
    const shown = changes.slice(-MAX_TRACE_STEPS);
    const dropped = changes.length - shown.length;
    const steps = [
        ...(dropped ? [i18nInstance.t('agent.tools.subLoop.changesCut', {count: dropped})] : []),
        ...shown.map(stepLine),
    ].join('\n');
    return `${text}\n\n${i18nInstance.t('agent.tools.subLoop.changes', {steps})}`;
}

/**
 * Only where a run that came back did not answer. A run that answered says what it did in its own
 * words, better than a list of paths ever would. Three endings of one are not an answer: the two
 * stop reasons that are not one, and the run that used up its turns mid-work -- which ends the
 * loop with the same reason as a run that had finished, and is the likeliest of the three to have
 * left work half done. A run stopped by the user is left out of it: everything above it is being
 * stopped too, so there is nobody upstairs to pick the work up.
 *
 * A run that threw never reaches this and is asked no such question. It answered nothing by
 * definition, and the ending likeliest of all to have left a file half written.
 */
function withChanges(text: string, changes: FootPrint[], runtime: AgentRuntime): string {
    return answered(runtime) ? text : appendChanges(text, changes);
}

function answered(runtime: AgentRuntime): boolean {
    const failed = runtime.transitionReason === 'error' || runtime.transitionReason === 'refused';
    return !failed && !runtime.hitTurnLimit;
}

/** A step of a branch, named as one: the run reading this is not the run that took it. */
function stepLine(step: FootPrint): string {
    const type = step.viaSubagent ? `${step.type} (subagent)` : step.type;
    return `${type}: ${oneLine(step.content)}`;
}

/** A step is read as a line of a list, and a command can be a script. */
function oneLine(content: string): string {
    const line = content.replace(/\s+/g, ' ').trim();
    return line.length > MAX_TRACE_STEP_LENGTH ? `${line.slice(0, MAX_TRACE_STEP_LENGTH)}...` : line;
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
        const text = withChanges(result.text, loop.getChangeTrace(), result.runtime);
        return withDrawnImages(text, loop.getDrawnImages());
    } catch (error) {
        // The one ending that leaves the loop above nothing at all. What a run that came back with
        // an error hands up is a line and a list of what it had got done; a run that threw hands up
        // the same line, and the list would go with the session unless it is put here -- the throw
        // is on its way to the model as the whole of what this call was, three frames up.
        const changes = loop.getChangeTrace();
        if (!changes.length) {
            throw error;
        }
        const said = error instanceof Error ? error.message : String(error);
        throw new Error(appendChanges(said, changes), {cause: error});
    } finally {
        carryChangesUp(loop, context);
        const sessionDir = loop.getSessionDir();
        FileUtils.deleteDir(sessionDir);
        SessionService.dropSession(sessionDir);
    }
}

/**
 * What the subagent changed becomes part of what the loop above it changed, the run being a tree
 * and the work of the tree being nobody's alone. Without this a task loop reports the files it
 * wrote with its own hands and nothing of the three subagents it handed the real work to, whose
 * traces live in tool results that go with the session; a whole branch of the work would be
 * missing from the very account that says what is left of it.
 *
 * Marked as somebody else's doing on the way up, a step of a branch being no step of the run: it
 * says whose hands were on the file, and it says why the list runs as it does, a branch landing
 * all at once when it came back.
 *
 * The changes and nothing else. What the subagent read is its own business and would land in the
 * list of files this conversation has already seen, which is read as files in this context: a
 * summary written here would tell the loop it knows the contents of files it has never opened.
 *
 * Only where the loop above is itself a spawned one, which is the whole of who is ever asked for
 * an account. A main loop is asked for none: it answers a user, and what it has to say about a
 * subagent it wrote down in its own words at the time. Handed them anyway it would hold every
 * change of every subagent of a whole conversation, read by nobody -- the dead weight the carried
 * list is filtered to keep out, on the live list instead.
 */
function carryChangesUp(loop: LoopAgent<any, any, any>, context: OneLoopContext): void {
    if (!isSpawnedLoop(context.loopKind)) {
        return;
    }
    loop.getChangeTrace()
        .forEach(change => context.actions.addFootPrint({...change, viaSubagent: true}));
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

/**
 * Whether the task about to be handed over is the one this loop had taken on itself. Its own hold
 * is the one thing on that list that is no reason to refuse a handover: what the hold says is that
 * this loop is working the task, and this loop is right here saying it would rather not.
 */
function holdsItself(context: OneLoopContext, projectId: string, taskId: string): boolean {
    const held = RunningTaskService.takenByHand(context.loopId);
    return held?.projectId === projectId && held?.taskId === taskId;
}

/**
 * Refuses a task that cannot be found instead of running an unfocused loop for it. The task always
 * comes from the project of the session: memory, skills and the files of a spawned loop are scoped
 * to the loop that spawned it, so a task of another project would be worked on with the wrong ones
 * around it. The run is filed under whoever the subagent stands for, which is the assignee of the
 * task wherever there is one: that is the page the run belongs on.
 *
 * Nothing is written here, the board included: what this finds out is what the run is claimed with,
 * and the claim has to be the first thing that happens once it has.
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
    // The whole project waits on one word from the user, so this is asked of the project rather
    // than of the task, and asked here rather than left to the prompt: a plan being talked over is
    // exactly when a model is most sure the work can begin.
    if (!isProjectStarted(ProjectManager.getProjectDetail(projectId))) {
        throw new Error('The user has not started this project. No task of it goes to a subagent ' +
            'before they press start on the board: tell them what is ready to go and wait.');
    }
    if (task.status === 'done') {
        throw new Error(`Task "${task.title}" is done, and a done task never goes back to ongoing.`);
    }
    if (RunningTaskService.isRunning(projectId, task.id) && !holdsItself(context, projectId, task.id)) {
        throw new Error(`"${task.title}" is being worked on already, wait for that to come back.`);
    }
    return {
        projectId,
        taskId: task.id,
        agentId: task.assignee || context.agentId,
        startedAt: new Date().toISOString(),
    };
}

/**
 * The task is on from here. Moving the step index is all a task loop may do to its own task, and
 * that is refused while the task is still todo; waiting for the assigning loop to remember it would
 * waste the run.
 *
 * Turned only once there is a run to turn it for. Building that run can fail -- an assignee whose
 * endpoint names no protocol we speak -- and a task left ongoing behind a handover that never
 * happened is one nobody can hand to anybody else: the board takes an assignee on a todo task and
 * on no other. Nor could anything here put it back, ongoing being a one-way step of the board as
 * well, so the order is the only place this can be got right.
 */
function markOngoing(run: PlannedRun, context: OneLoopContext): void {
    if (ProjectManager.getTask(run.projectId, run.taskId)?.status !== 'todo') {
        return;
    }
    ProjectManager.updateTask(run.projectId, {id: run.taskId, status: 'ongoing'});
    ProjectManager.fireProjectInfoEvent(run.projectId, context);
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
        // A task this loop had taken on itself and is handing over after all. What it held ends
        // where the handover begins, both of them saying who is working the task and only one of
        // them being true from here.
        if (holdsItself(context, run.projectId, run.taskId)) {
            RunningTaskService.dropByHand(context.loopId);
        }
        // Claimed before anything is awaited, the plan above being what says the task is free. Calls
        // of one turn run beside each other, and building a loop is an await however it goes, so a
        // claim made after it would leave two calls naming the same task both past a check neither
        // of them had yet answered, and two subagents at work in the same files.
        const runId = startRun(run, context);
        try {
            const taskLoop = await context.actions.newTaskLoop({
                projectId: run.projectId, taskId: run.taskId,
            }) as LoopAgent<any, any, any>;
            markOngoing(run, context);
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
