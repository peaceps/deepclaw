import { FileUtils } from '@deepclaw/node-utils';
import { addTokenUsage } from '@deepclaw/core';
import { i18nInstance } from '@deepclaw/i18n';
import { AssignedTask, OneLoopContext } from '../../definitions/definitions';
import { ToolDesc } from '../../definitions/tool-definitions';
import { LoopAgent } from '../loop/loop';
import { ProjectManager } from '../services/project-manager';
import { SessionService } from '../services/session-service';

type SubLoopInput = {
    prompt: string;
    taskTitle?: string;
}

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
 * Refuses a task that cannot be found instead of running an unfocused sub loop for it. The task
 * always comes from the project of the session: memory, skills and the files of a sub loop are
 * scoped to the loop that spawned it, so a task of another project would be worked on with the
 * wrong ones around it.
 */
function assignTask(input: SubLoopInput, context: OneLoopContext): AssignedTask | undefined {
    if (!input.taskTitle) {
        return undefined;
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
    // Moving the step index is all a sub loop may do to its task, and that is refused while the
    // task is still todo. Waiting for the assigning loop to remember it would waste the run.
    if (task.status === 'todo') {
        ProjectManager.updateTask(projectId, {title: task.title, status: 'ongoing'});
        ProjectManager.fireProjectInfoEvent(projectId, context);
    }
    return {projectId, taskTitle: task.title};
}

export const subLoopTool: ToolDesc<SubLoopInput> = {
    tool: {
        name: 'sub_loop',
        description: `Spawn a subagent with fresh context. It shares the filesystem but not conversation history.
Name a task of the project of this session to let the subagent work on that task alone: it answers
under the name of the agent the task is assigned to and gets the description and the steps of the
task in its prompt.
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
        const assignedTask = assignTask(input, context);
        const subLoop = context.actions.newSubLoop(assignedTask) as LoopAgent<any, any, any>;
        try {
            const result = await subLoop.invoke(input.prompt, { browserId: context.browserId });
            // The sub loop keeps no session of its own, so its tokens are only ever counted here.
            addTokenUsage(context.runtime.usage, result.runtime.usage);
            return withDrawnImages(result.text, subLoop.getDrawnImages());
        } finally {
            const sessionDir = subLoop.getSessionDir();
            FileUtils.deleteDir(sessionDir);
            SessionService.dropSession(sessionDir);
        }
    },
}
