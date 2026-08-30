import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import type {
    AgentEmployee, ChatMessage, CronTask, SlimProject, RunningTask, Task
} from '@deepclaw/core';
import type {DeepclawDataInfo} from '@deepclaw/loop-gateway';
import {type AgentActivity, deriveAgentSummary, sessionBrowserId, useAppStore} from './store';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The word that set a project going, which is what says the work on it is on. */
const STARTED = '2024-01-02T00:00:00.000Z';

function newAgent(overrides: Partial<AgentEmployee> = {}): AgentEmployee {
    return {
        id: 'a1',
        name: 'Ada',
        avatar: '🐋',
        role: 'engineer',
        personalities: ['calm'],
        emotion: true,
        expertises: ['typescript'],
        fired: false,
        description: 'writes code',
        mood: 'happy',
        ...overrides,
    };
}

function newTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'write-tests',
        title: 'write tests',
        description: 'cover the store',
        status: 'todo',
        priority: 'medium',
        blockedBy: [],
        blocks: [],
        ...overrides,
    };
}

/** Tasks and all, as a project reaches a row that opened. A row that did not is `newProjectRow`. */
function newProject(overrides: Partial<SlimProject> = {}): SlimProject {
    return {
        id: 'p1',
        title: 'Ship it',
        description: 'a project',
        createdAt: '2024-01-01T00:00:00.000Z',
        creator: 'a1',
        priority: 'medium',
        tasks: {},
        taskCount: 0,
        completedTasks: [],
        ongoingTasks: [],
        canStartTasks: [],
        ...overrides,
    };
}

/** A project as the board is handed it, holding the count of its tasks and none of the tasks. */
function newProjectRow(overrides: Partial<SlimProject> = {}): SlimProject {
    const row = newProject(overrides);
    delete row.tasks;
    return row;
}

function newRunningTask(overrides: Partial<RunningTask> = {}): RunningTask {
    return {
        runId: 'r1',
        projectId: 'p1',
        taskId: 'ship-it',
        agentId: 'a1',
        kind: 'work',
        startedAt: '2024-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function newCronTask(overrides: Partial<CronTask> = {}): CronTask {
    return {
        id: 'c1',
        title: 'daily report',
        creator: 'a1',
        cron: '0 9 * * *',
        prompt: 'write the report',
        nextRun: '2024-01-02T09:00:00.000Z',
        histories: [],
        usage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
        ...overrides,
    };
}

function idle(overrides: Partial<AgentActivity> = {}): AgentActivity {
    return {runningTasks: [], busyLoops: [], ...overrides};
}

function newChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
    return {
        id: 'm1',
        agentId: 'a1',
        content: 'hello',
        type: 'user',
        timestamp: '2024-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function store(): ReturnType<typeof useAppStore.getState> {
    return useAppStore.getState();
}

/** The tasks of a project a test put there itself, which are always there to be read. */
function tasksOf(projectId: string): Record<string, Task> {
    return store().getProjects().find(project => project.id === projectId)!.tasks!;
}

describe('deriveAgentSummary', () => {

    test('reports a missing agent as fired with an empty count', () => {
        expect(deriveAgentSummary(undefined, [newProject()], idle()))
            .toEqual({status: 'fired', stats: {todo: [], ongoing: [], done: []}});
    });

    test('lists only the projects the agent created', () => {
        const projects = [newProject(), newProject({id: 'p2', creator: 'a2', title: 'Not mine'})];
        expect(deriveAgentSummary(newAgent(), projects, idle()).stats)
            .toEqual({todo: ['Ship it'], ongoing: [], done: []});
    });

    test('sorts the projects into todo, ongoing and done', () => {
        const projects = [
            newProject(),
            newProject({id: 'p2', title: 'Half way', startedAt: STARTED, ongoingTasks: ['t1']}),
            newProject({id: 'p3', title: 'Nearly there', startedAt: STARTED, completedTasks: ['t1']}),
            newProject({id: 'p4', title: 'All done', closedAt: '2024-02-01T00:00:00.000Z'}),
        ];
        expect(deriveAgentSummary(newAgent(), projects, idle()).stats)
            .toEqual({todo: ['Ship it'], ongoing: ['Half way', 'Nearly there'], done: ['All done']});
    });

    test('is idle with nothing running', () => {
        expect(deriveAgentSummary(newAgent(), [], idle()).status).toBe('idle');
    });

    /** A project waiting to be worked on says nothing about anyone being at work on it. */
    test('stays idle while its open projects wait for a subagent', () => {
        const projects = [newProject(), newProject({id: 'p2', ongoingTasks: ['t1']})];
        expect(deriveAgentSummary(newAgent(), projects, idle()).status).toBe('idle');
    });

    test('is busy while a subagent runs a task of this agent', () => {
        const activity = idle({runningTasks: [newRunningTask()]});
        expect(deriveAgentSummary(newAgent(), [], activity).status).toBe('busy');
    });

    test('is idle while the only run belongs to another agent', () => {
        const activity = idle({runningTasks: [newRunningTask({agentId: 'a2'})]});
        expect(deriveAgentSummary(newAgent(), [], activity).status).toBe('idle');
    });

    test('is busy while a loop of this agent works, whatever its role', () => {
        expect(deriveAgentSummary(newAgent(), [], idle({busyLoops: ['cron.a1']})).status).toBe('busy');
    });

    test('is idle while the only working loop belongs to another agent', () => {
        const activity = idle({busyLoops: ['agent.a2', 'project.a2.p1']});
        expect(deriveAgentSummary(newAgent(), [], activity).status).toBe('idle');
    });

    test('reports a fired agent as fired but still counts the projects', () => {
        const summary = deriveAgentSummary(
            newAgent({fired: true}), [newProject({startedAt: STARTED, ongoingTasks: ['t1']})],
            idle({runningTasks: [newRunningTask()]})
        );
        expect(summary).toEqual({status: 'fired', stats: {todo: [], ongoing: ['Ship it'], done: []}});
    });
});

describe('sessionBrowserId', () => {

    function stubSession(stored: Record<string, string>): void {
        vi.stubGlobal('window', {
            sessionStorage: {
                getItem: (key: string) => stored[key] ?? null,
                setItem: (key: string, value: string) => { stored[key] = value; },
            },
        });
    }

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test('answers with the id the session already holds', () => {
        stubSession({'browser.id': 'the-same-tab'});
        expect(sessionBrowserId()).toBe('the-same-tab');
    });

    test('leaves the id it generates in the session for the next load', () => {
        const stored: Record<string, string> = {};
        stubSession(stored);
        const browserId = sessionBrowserId();
        expect(browserId).toMatch(uuidPattern);
        expect(stored).toEqual({'browser.id': browserId});
    });

    test('makes up an id where there is no session to keep it in', () => {
        expect(sessionBrowserId()).toMatch(uuidPattern);
    });
});

describe('app store', () => {

    beforeEach(() => {
        useAppStore.setState({
            agents: [],
            activeAgents: [],
            projects: [],
            cronTasks: [],
            messages: {},
            busyChatKeys: {},
            selectedAgentId: null,
            openChatCall: null,
            initializedChat: {},
            emotionPopup: {},
            dataEpoch: 0,
        });
    });

    describe('browserId', () => {

        test('is a uuid taken once at load', () => {
            expect(store().browserId).toMatch(uuidPattern);
        });
    });

    describe('setDataInfo', () => {

        function newDataInfo(overrides: Partial<DeepclawDataInfo> = {}): DeepclawDataInfo {
            return {
                agents: [newAgent()],
                projects: [newProjectRow()],
                runningTasks: [newRunningTask()],
                busyLoops: ['agent.a1'],
                cronTasks: [newCronTask()],
                ...overrides,
            };
        }

        test('puts every part of it in the store at once', () => {
            store().setDataInfo(newDataInfo());
            expect(store().getAgents().map(agent => agent.id)).toEqual(['a1']);
            expect(store().getProjects().map(project => project.id)).toEqual(['p1']);
            expect(store().runningTasks.map(run => run.runId)).toEqual(['r1']);
            expect(store().busyLoops).toEqual(['agent.a1']);
            expect(store().cronTasks.map(task => task.id)).toEqual(['c1']);
        });

        /** Through setAgents rather than around it, so the hired are told from the fired here too. */
        test('works out the active agents and picks one to show', () => {
            store().setDataInfo(newDataInfo({
                agents: [newAgent({id: 'a2', fired: true}), newAgent()],
            }));
            expect(store().activeAgents.map(agent => agent.id)).toEqual(['a1']);
            expect(store().selectedAgentId).toBe('a1');
        });

        /**
         * Read by whoever has a request in the air: an answer asked for before the count moved
         * speaks of the list that has been replaced since, and is dropped rather than written.
         */
        test('counts every time the whole of it is put there', () => {
            store().setDataInfo(newDataInfo());
            store().setDataInfo(newDataInfo());
            expect(store().getDataEpoch()).toBe(2);
        });

        /**
         * No tasks travel in the list, so whoever was drawing the tasks of a project is left
         * wanting them, which is how they come to be asked for again.
         */
        test('leaves no tasks on a project that had them', () => {
            store().setProjects([newProject({tasks: {'write-tests': newTask()}})]);
            store().setDataInfo(newDataInfo());
            expect(store().getProjects()[0].tasks).toBeUndefined();
        });
    });

    describe('setAgents', () => {

        test('keeps every agent but only the hired ones as active', () => {
            store().setAgents([newAgent(), newAgent({id: 'a2', fired: true})]);
            expect(store().getAgents().map(agent => agent.id)).toEqual(['a1', 'a2']);
            expect(store().activeAgents.map(agent => agent.id)).toEqual(['a1']);
        });

        test('selects the first active agent when nothing is selected yet', () => {
            store().setAgents([newAgent({id: 'a2', fired: true}), newAgent()]);
            expect(store().selectedAgentId).toBe('a1');
        });

        test('keeps a selection that is still active', () => {
            store().setAgents([newAgent(), newAgent({id: 'a2'})]);
            store().setSelectedAgent('a2');
            store().setAgents([newAgent(), newAgent({id: 'a2'})]);
            expect(store().selectedAgentId).toBe('a2');
        });

        test('falls back to the first active agent when the selected one was fired', () => {
            store().setAgents([newAgent(), newAgent({id: 'a2'})]);
            store().setSelectedAgent('a2');
            store().setAgents([newAgent(), newAgent({id: 'a2', fired: true})]);
            expect(store().selectedAgentId).toBe('a1');
        });

        test('clears the selection when no agent is active anymore', () => {
            store().setAgents([newAgent()]);
            store().setAgents([newAgent({fired: true})]);
            expect(store().selectedAgentId).toBeNull();
        });

        test('leaves the selection empty for an empty roster', () => {
            store().setAgents([]);
            expect(store().selectedAgentId).toBeNull();
        });
    });

    describe('getAgentById', () => {

        test('finds a known agent', () => {
            store().setAgents([newAgent(), newAgent({id: 'a2'})]);
            expect(store().getAgentById('a2')?.id).toBe('a2');
        });

        test('finds a fired agent as well', () => {
            store().setAgents([newAgent({fired: true})]);
            expect(store().getAgentById('a1')?.fired).toBe(true);
        });

        test('returns nothing for an unknown id', () => {
            expect(store().getAgentById('ghost')).toBeUndefined();
        });
    });

    describe('updateAgentEmployee', () => {

        test('merges the patch into the known agent', () => {
            store().setAgents([newAgent()]);
            store().updateAgentEmployee({id: 'a1', mood: 'tired', name: 'Ada Lovelace'});
            expect(store().getAgentById('a1')).toEqual(newAgent({mood: 'tired', name: 'Ada Lovelace'}));
        });

        test('adds an unknown agent from the patch alone', () => {
            store().updateAgentEmployee({id: 'a9', name: 'Newcomer'});
            expect(store().getAgents()).toEqual([{id: 'a9', name: 'Newcomer'}]);
        });

        test('drops a field that is patched with null', () => {
            store().setAgents([newAgent({description: 'writes code'})]);
            store().updateAgentEmployee({id: 'a1', description: null});
            expect(store().getAgentById('a1')).not.toHaveProperty('description');
        });

        test('takes a fired agent out of the active list', () => {
            store().setAgents([newAgent(), newAgent({id: 'a2'})]);
            store().updateAgentEmployee({id: 'a1', fired: true});
            expect(store().activeAgents.map(agent => agent.id)).toEqual(['a2']);
        });

        test('puts a rehired agent back into the active list', () => {
            store().setAgents([newAgent({fired: true})]);
            store().updateAgentEmployee({id: 'a1', fired: false});
            expect(store().activeAgents.map(agent => agent.id)).toEqual(['a1']);
        });

        test('keeps the order of the roster when an agent is rehired', () => {
            store().setAgents([newAgent(), newAgent({id: 'a2', fired: true}), newAgent({id: 'a3'})]);
            store().updateAgentEmployee({id: 'a2', fired: false});
            expect(store().activeAgents.map(agent => agent.id)).toEqual(['a1', 'a2', 'a3']);
        });

        test('leaves the selection pointing at an agent that was just fired', () => {
            store().setAgents([newAgent(), newAgent({id: 'a2'})]);
            store().updateAgentEmployee({id: 'a1', fired: true});
            expect(store().selectedAgentId).toBe('a1');
        });

        test('selects the first agent hired after the page was loaded without any', () => {
            store().setAgents([]);
            store().updateAgentEmployee({id: 'a9', name: 'Newcomer'});
            expect(store().selectedAgentId).toBe('a9');
        });

        test('leaves a standing selection alone when another agent is hired', () => {
            store().setAgents([newAgent()]);
            store().updateAgentEmployee({id: 'a2', name: 'Newcomer'});
            expect(store().selectedAgentId).toBe('a1');
        });

        test('selects nobody while the only agent of the patch is fired', () => {
            store().setAgents([]);
            store().updateAgentEmployee({id: 'a9', name: 'Newcomer', fired: true});
            expect(store().selectedAgentId).toBeNull();
        });
    });

    describe('emotion popup', () => {

        test('holds the emotion of an agent with the moment it arrived', () => {
            const before = Date.now();
            store().showEmotionPopup('a1', 'this is fun');
            const popup = store().emotionPopup['a1'];
            expect(popup).toMatchObject({text: 'this is fun', seq: 1});
            expect(popup!.at).toBeGreaterThanOrEqual(before);
        });

        /** The bubble is keyed by seq, so the bump is what replays it for a second emotion. */
        test('bumps the seq for every emotion of the same agent', () => {
            store().showEmotionPopup('a1', 'this is fun');
            store().showEmotionPopup('a1', 'now it is not');
            expect(store().emotionPopup['a1']).toMatchObject({text: 'now it is not', seq: 2});
        });

        test('counts the emotions of each agent on its own', () => {
            store().showEmotionPopup('a1', 'this is fun');
            store().showEmotionPopup('a2', 'mine too');
            expect(store().emotionPopup['a1']).toMatchObject({seq: 1});
            expect(store().emotionPopup['a2']).toMatchObject({text: 'mine too', seq: 1});
        });

        test('drops the popup of the dismissed agent alone', () => {
            store().showEmotionPopup('a1', 'this is fun');
            store().showEmotionPopup('a2', 'mine too');
            store().dismissEmotionPopup('a1');
            expect(store().emotionPopup['a1']).toBeUndefined();
            expect(store().emotionPopup['a2']).toBeDefined();
        });

        /** Two cards of the same agent can both dismiss, the second one has nothing left to do. */
        test('leaves the popups untouched when there is nothing to dismiss', () => {
            store().showEmotionPopup('a1', 'this is fun');
            const before = store().emotionPopup;
            store().dismissEmotionPopup('a2');
            expect(store().emotionPopup).toBe(before);
        });

        test('starts the seq over once a dismissed agent feels something again', () => {
            store().showEmotionPopup('a1', 'this is fun');
            store().dismissEmotionPopup('a1');
            store().showEmotionPopup('a1', 'back again');
            expect(store().emotionPopup['a1']).toMatchObject({text: 'back again', seq: 1});
        });
    });

    describe('projects', () => {

        test('replaces the whole list', () => {
            store().setProjects([newProject()]);
            store().setProjects([newProject({id: 'p2'})]);
            expect(store().getProjects().map(project => project.id)).toEqual(['p2']);
        });

        test('merges a patch into a known project', () => {
            store().setProjects([newProject()]);
            store().updateProject({id: 'p1', title: 'Ship it faster', priority: 'urgent'});
            expect(store().getProjects()[0]).toEqual(newProject({title: 'Ship it faster', priority: 'urgent'}));
        });

        test('appends a project that is not known yet', () => {
            store().setProjects([newProject()]);
            store().updateProject({id: 'p2', title: 'Next'});
            expect(store().getProjects().map(project => project.id)).toEqual(['p1', 'p2']);
        });

        test('drops a field that is patched with null', () => {
            store().setProjects([newProject({closedAt: '2024-02-01T00:00:00.000Z'})]);
            store().updateProject({id: 'p1', closedAt: null});
            expect(store().getProjects()[0]).not.toHaveProperty('closedAt');
        });
    });

    describe('cron tasks', () => {

        test('replaces the whole list', () => {
            store().setCronTasks([newCronTask()]);
            store().setCronTasks([newCronTask({id: 'c2'})]);
            expect(store().cronTasks.map(task => task.id)).toEqual(['c2']);
        });

        test('merges a patch into a known task', () => {
            store().setCronTasks([newCronTask()]);
            store().updateCronTask({id: 'c1', paused: true, nextRun: null});
            expect(store().cronTasks[0]).toEqual(newCronTask({paused: true, nextRun: undefined}));
        });

        test('appends a task that was created after the page loaded', () => {
            store().setCronTasks([newCronTask()]);
            store().updateCronTask(newCronTask({id: 'c2'}));
            expect(store().cronTasks.map(task => task.id)).toEqual(['c1', 'c2']);
        });

        /** A closed task never comes back, the service leaves it out of the list it hands over. */
        test('forgets a task that was closed', () => {
            store().setCronTasks([newCronTask(), newCronTask({id: 'c2'})]);
            store().updateCronTask({id: 'c1', closed: true});
            expect(store().cronTasks.map(task => task.id)).toEqual(['c2']);
        });
    });

    describe('updateProjectTask', () => {

        beforeEach(() => {
            store().setProjects([
                newProject({tasks: {
                    'write-tests': newTask(),
                    'ship-it': newTask({id: 'ship-it', title: 'ship it'}),
                }}),
                newProject({id: 'p2'}),
            ]);
        });

        test('merges the patch into the task with that id', () => {
            store().updateProjectTask('p1', {id: 'write-tests', status: 'ongoing', assignee: 'a1'});
            expect(tasksOf('p1')['write-tests'])
                .toEqual(newTask({status: 'ongoing', assignee: 'a1'}));
        });

        /** Nothing is filed under the title, so new words on a task leave it where it stood. */
        test('renames a task without moving it', () => {
            store().updateProjectTask('p1', {id: 'write-tests', title: 'cover the store'});
            expect(tasksOf('p1')['write-tests']).toEqual(newTask({title: 'cover the store'}));
            expect(Object.keys(tasksOf('p1'))).toEqual(['write-tests', 'ship-it']);
        });

        test('leaves the other tasks of the project untouched', () => {
            const before = tasksOf('p1')['ship-it'];
            store().updateProjectTask('p1', {id: 'write-tests', status: 'done'});
            expect(tasksOf('p1')['ship-it']).toBe(before);
        });

        test('leaves the other projects untouched', () => {
            const before = store().getProjects()[1];
            store().updateProjectTask('p1', {id: 'write-tests', status: 'done'});
            expect(store().getProjects()[1]).toBe(before);
        });

        test('drops a task field that is patched with null', () => {
            store().updateProjectTask('p1', {id: 'write-tests', assignee: 'a1'});
            store().updateProjectTask('p1', {id: 'write-tests', assignee: null});
            expect(tasksOf('p1')['write-tests']).not.toHaveProperty('assignee');
        });

        test('throws for an unknown project', () => {
            expect(() => store().updateProjectTask('ghost', {id: 'write-tests'})).toThrow('Project not found.');
        });

        test('throws for an unknown task', () => {
            expect(() => store().updateProjectTask('p1', {id: 'ghost'})).toThrow('Task not found.');
        });

        /**
         * Only a card writes here, and a card is drawn from tasks that were asked for: a project
         * holding none is one no card of was ever drawn, which is the same as an id nobody has.
         */
        test('throws for a project whose tasks were never asked for', () => {
            store().setProjects([newProjectRow()]);
            expect(() => store().updateProjectTask('p1', {id: 'write-tests'}))
                .toThrow('Task not found.');
        });
    });

    describe('addMessage and addPulledMessages', () => {

        test('starts a conversation with the first message', () => {
            store().addMessage('loop1', newChatMessage());
            expect(store().messages.loop1).toEqual([newChatMessage()]);
        });

        test('appends further messages in order', () => {
            store().addMessage('loop1', newChatMessage());
            store().addMessage('loop1', newChatMessage({id: 'm2'}));
            expect(store().messages.loop1.map(message => message.id)).toEqual(['m1', 'm2']);
        });

        test('keeps the conversations apart', () => {
            store().addMessage('loop1', newChatMessage());
            store().addMessage('loop2', newChatMessage({id: 'm2'}));
            expect(store().messages.loop2.map(message => message.id)).toEqual(['m2']);
        });

        /**
         * Two chats of one loop can be on the page at once, and both are told the message arrived.
         * A second copy would grow along with the first and read as a second answer.
         */
        test('holds a message told twice only once', () => {
            store().addMessage('loop1', newChatMessage({content: ''}));
            store().addMessage('loop1', newChatMessage({content: ''}));
            store().updateMessage('loop1', 'm1', 'an answer');
            expect(store().messages.loop1.map(message => message.content)).toEqual(['an answer']);
        });

        test('keeps the message it already holds rather than the one told again', () => {
            store().addMessage('loop1', newChatMessage({content: 'half of an answer'}));
            store().addMessage('loop1', newChatMessage({content: ''}));
            expect(store().messages.loop1).toEqual([newChatMessage({content: 'half of an answer'})]);
        });

        test('takes the same message into another conversation', () => {
            store().addMessage('loop1', newChatMessage());
            store().addMessage('loop2', newChatMessage());
            expect(store().messages.loop2).toEqual([newChatMessage()]);
        });

        test('appends pulled messages at the end by default', () => {
            store().addMessage('loop1', newChatMessage());
            store().addPulledMessages('loop1', [newChatMessage({id: 'm2'}), newChatMessage({id: 'm3'})]);
            expect(store().messages.loop1.map(message => message.id)).toEqual(['m1', 'm2', 'm3']);
        });

        test('prepends pulled history in front of the known messages', () => {
            store().addMessage('loop1', newChatMessage({id: 'm3'}));
            store().addPulledMessages('loop1', [newChatMessage(), newChatMessage({id: 'm2'})], true);
            expect(store().messages.loop1.map(message => message.id)).toEqual(['m1', 'm2', 'm3']);
        });

        test('creates an empty conversation when nothing was pulled', () => {
            store().addPulledMessages('loop1', []);
            expect(store().messages.loop1).toEqual([]);
        });

        /**
         * The answer this tab watched being written was finished while it looked elsewhere, and the
         * pull is how it learns the rest: the message it holds half written is that message.
         */
        test('replaces a message it already holds instead of holding it twice', () => {
            store().addMessage('loop1', newChatMessage({content: 'half of '}));
            store().addPulledMessages('loop1', [
                newChatMessage({content: 'half of an answer'}), newChatMessage({id: 'm2'}),
            ]);
            expect(store().messages.loop1.map(message => message.id)).toEqual(['m1', 'm2']);
            expect(store().messages.loop1[0].content).toBe('half of an answer');
        });

        /**
         * The answer is streamed to the tab and told to the server only once it is said, so a chat
         * opened again in the middle of one asks after it and is handed a message with nothing in
         * it. Taken as the later word, it would wipe what this tab watched arrive and the answer
         * would go on from whatever chunk came next.
         */
        test('keeps the answer it is watching arrive when the pull holds none of it yet', () => {
            store().addMessage('loop1', newChatMessage({content: 'half of an answer'}));
            store().addPulledMessages('loop1', [newChatMessage({content: ''})]);
            expect(store().messages.loop1[0].content).toBe('half of an answer');
        });

        test('takes a message that was pulled empty when nothing was held of it', () => {
            store().addPulledMessages('loop1', [newChatMessage({content: ''})]);
            expect(store().messages.loop1.map(message => message.id)).toEqual(['m1']);
        });

        test('replaces a message it already holds when the history comes in front', () => {
            store().addMessage('loop1', newChatMessage({id: 'm3', content: ''}));
            store().addPulledMessages('loop1', [
                newChatMessage(), newChatMessage({id: 'm3', content: 'the whole of it'}),
            ], true);
            expect(store().messages.loop1.map(message => message.id)).toEqual(['m1', 'm3']);
            expect(store().messages.loop1[1].content).toBe('the whole of it');
        });
    });

    describe('clearMessages', () => {

        test('drops what the chat held', () => {
            store().addMessage('loop1', newChatMessage());
            store().clearMessages('loop1');
            expect(store().messages.loop1).toBeUndefined();
        });

        test('leaves the other conversations alone', () => {
            store().addMessage('loop1', newChatMessage());
            store().addMessage('loop2', newChatMessage({id: 'm2'}));
            store().clearMessages('loop1');
            expect(store().messages.loop2.map(message => message.id)).toEqual(['m2']);
        });

        /** A tab keeping every conversation its user ever opened would only ever grow. */
        test('drops a conversation that was read back by the name it was read under', () => {
            store().addPulledMessages('loop1#20260101000000000', [newChatMessage()]);
            store().clearMessages('loop1#20260101000000000');
            expect(store().messages).toEqual({});
        });

        test('says nothing changed when there was no such conversation', () => {
            store().addMessage('loop1', newChatMessage());
            const before = store().messages;
            store().clearMessages('loop2');
            expect(store().messages).toBe(before);
        });
    });

    describe('message lookups', () => {

        test('reads the oldest and the newest id', () => {
            store().addPulledMessages('loop1', [newChatMessage(), newChatMessage({id: 'm2'})]);
            expect(store().getOldestMessageId('loop1')).toBe('m1');
            expect(store().getNewestMessageId('loop1')).toBe('m2');
        });

        test('reads the same id for a single message', () => {
            store().addMessage('loop1', newChatMessage());
            expect(store().getOldestMessageId('loop1')).toBe('m1');
            expect(store().getNewestMessageId('loop1')).toBe('m1');
        });

        test('reads nothing from an unknown conversation', () => {
            expect(store().getOldestMessageId('ghost')).toBeUndefined();
            expect(store().getNewestMessageId('ghost')).toBeUndefined();
            expect(store().getMessageById('ghost', 'm1')).toBeUndefined();
        });

        test('reads nothing from an empty conversation', () => {
            store().addPulledMessages('loop1', []);
            expect(store().getOldestMessageId('loop1')).toBeUndefined();
            expect(store().getNewestMessageId('loop1')).toBeUndefined();
        });

        test('finds a message by id', () => {
            store().addPulledMessages('loop1', [newChatMessage(), newChatMessage({id: 'm2'})]);
            expect(store().getMessageById('loop1', 'm2')?.id).toBe('m2');
        });

        test('returns nothing for an unknown id', () => {
            store().addMessage('loop1', newChatMessage());
            expect(store().getMessageById('loop1', 'ghost')).toBeUndefined();
        });

        test('returns the newest message when an id was used twice', () => {
            store().addPulledMessages('loop1', [
                newChatMessage({content: 'first'}), newChatMessage({content: 'second'}),
            ]);
            expect(store().getMessageById('loop1', 'm1')?.content).toBe('second');
        });
    });

    describe('updateMessage', () => {

        test('appends the chunk to the content', () => {
            store().addMessage('loop1', newChatMessage({content: 'hel'}));
            store().updateMessage('loop1', 'm1', 'lo');
            expect(store().messages.loop1[0].content).toBe('hello');
        });

        test('appends chunk after chunk', () => {
            store().addMessage('loop1', newChatMessage({content: ''}));
            store().updateMessage('loop1', 'm1', 'a');
            store().updateMessage('loop1', 'm1', 'b');
            expect(store().messages.loop1[0].content).toBe('ab');
        });

        test('leaves the other messages alone', () => {
            store().addPulledMessages('loop1', [newChatMessage(), newChatMessage({id: 'm2', content: 'other'})]);
            store().updateMessage('loop1', 'm1', '!');
            expect(store().messages.loop1[1].content).toBe('other');
        });

        test('ignores an unknown message id', () => {
            store().addMessage('loop1', newChatMessage());
            store().updateMessage('loop1', 'ghost', '!');
            expect(store().messages.loop1).toEqual([newChatMessage()]);
        });

        test('ignores an unknown conversation', () => {
            store().updateMessage('ghost', 'm1', '!');
            expect(store().messages).toEqual({});
        });

        test('appends the chunk to every message sharing the id', () => {
            store().addPulledMessages('loop1', [
                newChatMessage({content: 'first'}), newChatMessage({content: 'second'}),
            ]);
            store().updateMessage('loop1', 'm1', '!');
            expect(store().messages.loop1.map(message => message.content)).toEqual(['first!', 'second!']);
        });
    });

    describe('replaceMessage', () => {

        test('replaces the whole content', () => {
            store().addMessage('loop1', newChatMessage({content: 'draft'}));
            store().replaceMessage('loop1', 'm1', 'final');
            expect(store().messages.loop1[0].content).toBe('final');
        });

        test('keeps the rest of the message', () => {
            store().addMessage('loop1', newChatMessage());
            store().replaceMessage('loop1', 'm1', 'final');
            expect(store().messages.loop1[0]).toEqual(newChatMessage({content: 'final'}));
        });

        test('ignores an unknown message id', () => {
            store().addMessage('loop1', newChatMessage());
            store().replaceMessage('loop1', 'ghost', 'final');
            expect(store().messages.loop1).toEqual([newChatMessage()]);
        });

        test('ignores an unknown conversation', () => {
            store().replaceMessage('ghost', 'm1', 'final');
            expect(store().messages).toEqual({});
        });

        test('replaces the content of every message sharing the id', () => {
            store().addPulledMessages('loop1', [
                newChatMessage({content: 'first'}), newChatMessage({content: 'second'}),
            ]);
            store().replaceMessage('loop1', 'm1', 'final');
            expect(store().messages.loop1.map(message => message.content)).toEqual(['final', 'final']);
        });
    });

    describe('setChatBusy', () => {

        test('marks a conversation busy', () => {
            store().setChatBusy('loop1', true);
            expect(store().busyChatKeys.loop1).toBe(true);
        });

        test('marks a conversation free again', () => {
            store().setChatBusy('loop1', true);
            store().setChatBusy('loop1', false);
            expect(store().busyChatKeys.loop1).toBe(false);
        });

        test('keeps a flag per conversation', () => {
            store().setChatBusy('loop1', true);
            store().setChatBusy('loop2', false);
            expect(store().busyChatKeys).toEqual({loop1: true, loop2: false});
        });
    });

    describe('setSelectedAgent', () => {

        test('selects an agent', () => {
            store().setSelectedAgent('a2');
            expect(store().selectedAgentId).toBe('a2');
        });

        test('clears the selection', () => {
            store().setSelectedAgent('a2');
            store().setSelectedAgent(null);
            expect(store().selectedAgentId).toBeNull();
        });

        test('does not check that the agent exists', () => {
            store().setAgents([newAgent()]);
            store().setSelectedAgent('ghost');
            expect(store().selectedAgentId).toBe('ghost');
        });
    });

    describe('openChat', () => {

        test('names the loop whose chat was called for', () => {
            store().openChat('agent.a1');
            expect(store().openChatCall).toEqual({loopId: 'agent.a1', seq: 1});
        });

        /** The chat of an agent is shown beside the selected agent, so it has to become that one. */
        test('selects the agent of an agent loop', () => {
            store().openChat('agent.a2');
            expect(store().selectedAgentId).toBe('a2');
        });

        test('leaves the selected agent alone for a project loop', () => {
            store().setSelectedAgent('a1');
            store().openChat('project.a2.p1');
            expect(store().selectedAgentId).toBe('a1');
        });

        test('replaces the loop of a call that came before', () => {
            store().openChat('agent.a1');
            store().openChat('project.a2.p1');
            expect(store().openChatCall?.loopId).toBe('project.a2.p1');
        });

        /** A page answers a call once, so asking again for the chat it shows has to be a new call. */
        test('counts every call, the same chat asked for twice included', () => {
            store().openChat('agent.a1');
            store().openChat('agent.a1');
            expect(store().openChatCall).toEqual({loopId: 'agent.a1', seq: 2});
        });
    });
});
