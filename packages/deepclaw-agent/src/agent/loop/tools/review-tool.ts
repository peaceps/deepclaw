import { type LLMTaskOutput, type Task } from '@deepclaw/core';
import { type OneLoopContext } from '../../definitions/definitions';
import { type ToolDesc } from '../../definitions/tool-definitions';
import { EXT_DESCRIPTION } from '../../loop-utils';
import { LoopAgent } from '../loop/loop';
import { ProjectManager } from '../services/project-manager';
import { fireRunningTasksEvent, RunningTaskService } from '../services/running-task-service';
import { runSpawnedLoop } from './spawned-loop-tool';

/**
 * How many readings one turn may have going at once. Smaller than the cap on handing tasks out: a
 * review is easier to ask for in bulk -- one "have them all looked over" is the whole board -- and
 * each of them runs the tests and the build of the same machine.
 *
 * The cap of a group is the narrowest cap in it, so this one also holds the task_loop calls that
 * land beside it. That is the same machine again, and worth knowing before the number is changed.
 */
const MAX_PARALLEL_REVIEWS = 2;

type ReviewTaskInput = {
    taskId: string;
    prompt: string;
};

type SubmitReviewInput = {
    verdict: 'passed' | 'rejected';
    output: LLMTaskOutput;
};

/**
 * What a task the reader is pointed at has to be, and who may point at which task.
 *
 * A task loop asks about the one task it was given and about no other -- a subagent has no business
 * with a sibling task -- while the main loop owns the board and may ask about any task on it that
 * is under way, the one it is working with its own hands included. The typical call from up there
 * is exactly that: a subagent reported back without having the work read over, and the loop that
 * handed the task out is the one that has to see to it.
 *
 * Nothing is written here. What this works out is what the run is claimed with, and the claim is
 * the first thing that happens once it has.
 */
function planReview(input: ReviewTaskInput, context: OneLoopContext): {task: Task, reviewer: string} {
    if (!input.taskId) {
        throw new Error('Name the task of this project that has to be read over.');
    }
    const projectId = context.projectId;
    if (!projectId) {
        throw new Error('This session runs no project, only a project session has tasks to review.');
    }
    const task = ProjectManager.getTask(projectId, input.taskId);
    if (!task) {
        throw new Error(`Task "${input.taskId}" not found in project "${projectId}".`);
    }
    const own = context.assignedTask?.taskId;
    if (own && own !== task.id) {
        throw new Error(`You were given "${own}" and can only ask for a review of that task.`);
    }
    if (!task.reviewer) {
        throw new Error(`Nobody reads "${task.title}" over: it has no reviewer, and a task without `
            + 'one is closed on your own word.');
    }
    if (task.status !== 'ongoing') {
        throw new Error(`Only work under way is read over, and "${task.title}" is ${task.status}.`);
    }
    // A claim nobody reads is no claim. Two calls of one turn run beside each other and building a
    // loop is an await, so without this both would walk past a question neither had answered yet
    // and the same task would be read twice over, the second verdict written across the first.
    if (RunningTaskService.isReviewRunning(projectId, task.id)) {
        throw new Error(`"${task.title}" is being read over right now, wait for that verdict.`);
    }
    // A subagent on the task, which is a workspace being written while it is read.
    //
    // Subagents and nothing else, deliberately. The hands are left out rather than overlooked: the
    // board of a project is written by the run of that project alone -- every tool that moves a
    // task says `roles: ['project']` -- so a hand on this task is this very run's, asking between
    // two edits of its own. And asked from a task loop the question would find that task loop, the
    // work under way on the task being the run that wants it read: hence the main loop named here,
    // rather than a wider question with the asker cut out of it.
    if (context.loopKind === 'main' && RunningTaskService.isTaskLoopRunning(projectId, task.id)) {
        throw new Error(`A subagent is working on "${task.title}" right now. A review reads what is `
            + 'there, so wait for it to report back and ask then.');
    }
    return {task, reviewer: task.reviewer};
}

export const reviewTaskTool: ToolDesc<ReviewTaskInput> = {
    tool: {
        name: 'review_task',
        description: `Have the reviewer of a task read the work over. It runs as that agent, with
their model and their memory, and starts with fresh context: it shares the filesystem and knows
nothing of this conversation. It reads what is really there rather than what anybody said about it,
and it changes nothing.
Have the report of the work written before you call this: the reviewer is handed the task as the
board has it, so a report that is not on the task yet is a report it cannot read. Where the task is
yours to write, put it there with update_task first, carrying the output and no status.
A task that names a reviewer is not closed before one verdict is in, whichever way that verdict
went: a rejection is what the reviewer thinks, not a lock on the task.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                taskId: {
                    type: 'string',
                    description: 'The id of the task of this project that has to be read over.',
                },
                prompt: {
                    type: 'string',
                    description: `What was done and where it landed: the files, the commands to run,
what to look at first. The reviewer is told this is your account rather than the finding, and checks
it against the workspace, so leaving something out only costs it the time to find it.
Where the task carries no report yet -- which is the case for as long as the work has not been
reported back -- this is the whole of what the reviewer reads about it, so put the account of the
work in here entire rather than pointing at where it will be written.`,
                },
            },
            required: ['taskId', 'prompt'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: true,
    maxParallel: MAX_PARALLEL_REVIEWS,
    // The loop working a task calls for its own review while the work is still in its hands, which
    // is where a fix is cheapest. The main loop is the other caller, for the task that came back
    // unread and for the one it is working itself.
    loopKinds: ['main', 'task'],
    roles: ['project'],
    invoke: async function(input: ReviewTaskInput, context: OneLoopContext): Promise<string> {
        const {task, reviewer} = planReview(input, context);
        const projectId = context.projectId;
        // Claimed before anything is awaited, and under the name of the reviewer rather than of
        // whoever the task belongs to: the board draws a run beside the agent it is filed under,
        // and a review filed under the assignee would spin on the line of the one being read.
        const runId = RunningTaskService.startReviewRun({
            projectId, taskId: task.id, agentId: reviewer, startedAt: new Date().toISOString(),
        });
        fireRunningTasksEvent(context);
        // What stood on the task before this run, so that a verdict from an earlier reading is not
        // read back as the answer to this one. The time and not the record: a project reloaded from
        // disk answers with an equal review that is another object.
        const before = task.review?.at;
        try {
            const reviewLoop = await context.actions.newReviewLoop({
                projectId, taskId: task.id,
            }) as LoopAgent<any, any, any>;
            const failure = await readOver(reviewLoop, input.prompt, context);
            const after = ProjectManager.getTask(projectId, task.id);
            if (!after?.review || after.review.at === before) {
                throw new Error(`The review of "${task.title}" came back without a verdict`
                    + `${failure ? ` (${failure})` : ''}. Run it once more, or tell the user what `
                    + 'happened and leave the task open.');
            }
            // The user closed the task while it was being read, which writes a waiver dated now --
            // new enough to pass for this run's own answer. There is no verdict behind it and the
            // prompt for one is empty, so it is said here: an empty tool result tells the model
            // nothing, and some providers will not carry one at all.
            if (after.review.verdict === 'waived') {
                return `The user closed "${task.title}" themselves while it was being read over, `
                    + 'so the reading stopped where it was and there is no verdict. The task is '
                    + 'done by their own hand, and it is theirs to say whether it is worth reading '
                    + 'now.';
            }
            return ProjectManager.promptTaskVerdict(projectId, task.id);
        } finally {
            RunningTaskService.finishReviewRun(runId);
            fireRunningTasksEvent(context);
        }
    },
};

/**
 * The reading itself. Nothing the run said is passed on -- what a review has to say it says with
 * submit_review, and its own words about the work would arrive beside the verdict as a second
 * opinion nobody filed -- so what comes back from here is how it failed, where it did.
 *
 * A stop is not one of those, though it arrives as one. Every layer below throws its own shape for
 * an abort, and what is thrown here ends up in the "no verdict, run it once more" above -- which
 * is advice to a user who has just said they want no more of it. Nothing is asked of the signal
 * here all the same: the tool layer reads it before any error of ours is passed on, and answers a
 * stopped run with the stop instead. Asked in both places, the two would drift.
 */
async function readOver(
    loop: LoopAgent<any, any, any>, prompt: string, context: OneLoopContext
): Promise<string> {
    try {
        await runSpawnedLoop(loop, prompt, context);
        return '';
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

export const submitReviewTool: ToolDesc<SubmitReviewInput> = {
    tool: {
        name: 'submit_review',
        description: `File your verdict on the task you were given to read. This is the only thing
you write anywhere, and the only part of this run anybody reads: whoever asked for the review is
handed the verdict and the report, and the report stays on the task for the user.
Call it once, at the end, whichever way you decided.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                verdict: {
                    type: 'string',
                    enum: ['passed', 'rejected'],
                    description: `"passed" where the work does what the task asked for, "rejected"
where it does not or where you could not check it at all. Say which of the two it was in the report.`,
                },
                output: {
                    type: 'object',
                    additionalProperties: false,
                    description: `Your report, which the user reads on the card and whoever asked
for the review reads whole. Name what you checked and how; where you found something, name the file
and the line, so that whoever picks it up goes straight to it.`,
                    properties: {
                        type: {type: 'string', enum: ['markdown', 'text']},
                        content: {
                            type: 'string',
                            description: `The report itself. Large content is filed away for you, so
there is no size to work around.`,
                        },
                        ext: {type: 'string', description: EXT_DESCRIPTION},
                    },
                    required: ['type', 'content'],
                },
            },
            required: ['verdict', 'output'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: false,
    // The one tool of the run that was spawned to read. Named here and nowhere else: a review is
    // outside the default set, so this is the whole of who ever sees it.
    loopKinds: ['review'],
    roles: ['project'],
    invoke: async function(input: SubmitReviewInput, context: OneLoopContext): Promise<string> {
        // The task is read off the run rather than asked for. A review that named its own task
        // could file a report on a task nobody asked it to read.
        const assigned = context.assignedTask;
        if (!assigned) {
            throw new Error('This run was given no task to read over.');
        }
        const {projectId, taskId} = assigned;
        const task = ProjectManager.getTask(projectId, taskId);
        if (!task) {
            throw new Error('The task you were reading is no longer on the board.');
        }
        if (task.status !== 'ongoing') {
            return `"${task.title}" was closed while you were reading it. Nothing is written on a `
                + 'task that is already done, so your verdict goes no further than this run.';
        }
        // A report is what somebody reads. The bytes of a file written into a tool call stay in the
        // context of this run for as long as it lives, and a review has nothing to hand over but
        // words: what it found in a file belongs in the report as the finding, not as the file.
        if (input.output.type === 'binary') {
            throw new Error('A report is read, not opened. Write what you found in the content, '
                + 'naming the file and the line rather than handing the file over.');
        }
        ProjectManager.submitReview(projectId, taskId, input.verdict, input.output);
        ProjectManager.fireProjectInfoEvent(projectId, context);
        return `Your verdict is on "${task.title}". Nothing else of this run is read by anybody, `
            + 'so stop here.';
    },
};
