import { getProjectProgress, getProjectStatus, type Project, type Task } from '@deepclaw/core';
import {
    expectAllToolsSucceeded, expectFile, expectMaxTurns, expectNoUnexpectedQuestion, expectProject,
    expectScriptFullyConsumed, expectStatus, expectToolCalled,
} from '../graders';
import { DEFAULT_AGENT_ID, type EvalScenario } from '../scenario';

/**
 * The one case where the graders know the right answer.
 *
 * A project is handed to the agent with two open tasks, one of them with steps. Whether the run
 * went well is not a matter of reading the transcript: the project on disk either says both tasks
 * are done, the steps were walked to the end, the notes file exists with the changelog in it and
 * the project closed itself - or it does not. The same graders keep their meaning when a real
 * model drives the run instead of the stub, which is what makes them worth writing by hand.
 */

const PROJECT_ID = 'release-0-4';
const DRAFT = 'draft-notes';
const ANNOUNCE = 'announce';
const DRAFT_TITLE = 'Draft the release notes';
const ANNOUNCE_TITLE = 'Announce the release';
const STEPS = ['read the changelog', 'write notes/release.md'];

const CHANGELOG = `- fix: the whale no longer forgets its name
- feat: agents can hand work to each other
`;

const RELEASE_NOTES = `# 0.4

- the whale no longer forgets its name
- agents can hand work to each other
`;

function openTask(id: string, title: string, description: string, steps?: string[]): Task {
    return {
        id,
        title,
        description,
        status: 'todo',
        priority: 'high',
        blockedBy: [],
        blocks: [],
        assignee: DEFAULT_AGENT_ID,
        stepsStatus: steps ? {steps, currentStepIndex: -1} : undefined,
    };
}

const RELEASE_PROJECT: Project = {
    id: PROJECT_ID,
    title: 'Ship 0.4',
    description: 'Write the release notes and tell the team about them.',
    createdAt: '2026-01-01T00:00:00.000Z',
    creator: DEFAULT_AGENT_ID,
    priority: 'high',
    tasks: {
        [DRAFT]: openTask(DRAFT, DRAFT_TITLE, 'Turn notes/changelog.md into notes/release.md.', STEPS),
        [ANNOUNCE]: openTask(ANNOUNCE, ANNOUNCE_TITLE, 'Tell the team the notes are ready.'),
    },
    completedTasks: [],
    ongoingTasks: [],
    canStartTasks: [DRAFT, ANNOUNCE],
};

export const worksAProjectToDone: EvalScenario = {
    id: 'works-a-project-to-done',
    description: 'Two open tasks are worked to done, and the project on disk has to say so afterwards.',
    seed: {
        files: {'notes/changelog.md': CHANGELOG},
        projects: [RELEASE_PROJECT],
    },
    script: [
        {
            text: 'Picking up the release notes first. ',
            toolCalls: [{name: 'update_task', input: {projectId: PROJECT_ID, taskId: DRAFT, status: 'ongoing'}}],
        },
        {
            toolCalls: [
                {name: 'update_task_current_step', input: {projectId: PROJECT_ID, taskId: DRAFT, stepIndex: 0}},
                {name: 'read_file', input: {filePath: 'notes/changelog.md'}},
            ],
        },
        {
            toolCalls: [
                {name: 'update_task_current_step', input: {projectId: PROJECT_ID, taskId: DRAFT, stepIndex: 1}},
                {name: 'write_file', input: {filePath: 'notes/release.md', content: RELEASE_NOTES}},
            ],
        },
        // The product refuses to close a task that has steps left, so the last step index has to
        // be the length of the list before the task may be marked done.
        {toolCalls: [{name: 'update_task_current_step', input: {projectId: PROJECT_ID, taskId: DRAFT, stepIndex: 2}}]},
        {
            toolCalls: [{
                name: 'update_task',
                input: {
                    projectId: PROJECT_ID,
                    taskId: DRAFT,
                    status: 'done',
                    output: {type: 'markdown', content: 'Release notes are in notes/release.md.'},
                },
            }],
        },
        {toolCalls: [{name: 'update_task', input: {projectId: PROJECT_ID, taskId: ANNOUNCE, status: 'ongoing'}}]},
        {
            toolCalls: [{
                name: 'update_task',
                input: {
                    projectId: PROJECT_ID,
                    taskId: ANNOUNCE,
                    status: 'done',
                    output: {type: 'text', content: 'Posted the notes to the team channel.'},
                },
            }],
        },
        {text: 'Both tasks are done, the notes are in notes/release.md.'},
    ],
    driver: {
        role: 'project',
        projectId: PROJECT_ID,
        prompt: 'Work this project to the end: draft the notes from notes/changelog.md, then announce them.',
    },
    limits: {maxTurns: 8},
    graders: [
        expectStatus('idle'),
        // A failing tool call is the interesting kind of failure here: update_task is where the
        // rules of the domain live, so a shortcut through the lifecycle turns up as a red call
        // rather than as a wrong-looking project.
        expectAllToolsSucceeded(),
        expectToolCalled('update_task', {projectId: PROJECT_ID, taskId: DRAFT, status: 'done'}),
        expectFile('notes/release.md', /agents can hand work to each other/),
        expectProject(
            project => Object.values(project?.tasks || {}).every(task => task.status === 'done'),
            'both tasks ended up done',
        ),
        expectProject(project => getProjectProgress(project) === 100, 'the project reads 100% complete'),
        expectProject(
            project => !!project && getProjectStatus(project) === 'done',
            'the project closed itself once the last task was done',
        ),
        expectProject(
            project => project?.tasks[DRAFT]?.stepsStatus?.currentStepIndex === STEPS.length,
            'every step of the drafting task was walked',
        ),
        expectProject(
            project => !!project?.tasks[DRAFT]?.output?.content.includes('notes/release.md')
                && !!project?.tasks[DRAFT]?.closedAt,
            'the drafting task kept its output and its closing time',
        ),
        expectMaxTurns(8),
        expectScriptFullyConsumed(),
        expectNoUnexpectedQuestion(),
    ],
};
