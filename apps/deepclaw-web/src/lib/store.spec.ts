import {beforeEach, describe, expect, test} from 'vitest';
import type {AgentEmployee, ChatMessage, Project, Task} from '@deepclaw/core';
import {deriveAgentSummary, useAppStore} from './store';

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
        title: 'write tests',
        description: 'cover the store',
        status: 'todo',
        priority: 'medium',
        blockedBy: [],
        blocks: [],
        ...overrides,
    };
}

function newProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 'p1',
        title: 'Ship it',
        description: 'a project',
        createdAt: '2024-01-01T00:00:00.000Z',
        creator: 'a1',
        priority: 'medium',
        tasks: {},
        completedTasks: [],
        ongoingTasks: [],
        canStartTasks: [],
        ...overrides,
    };
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

describe('deriveAgentSummary', () => {

    test('reports a missing agent as fired with an empty count', () => {
        expect(deriveAgentSummary(undefined, [newProject()]))
            .toEqual({status: 'fired', stats: {todo: 0, ongoing: 0, done: 0}});
    });

    test('counts only the projects the agent created', () => {
        const projects = [newProject(), newProject({id: 'p2', creator: 'a2'})];
        expect(deriveAgentSummary(newAgent(), projects).stats).toEqual({todo: 1, ongoing: 0, done: 0});
    });

    test('sorts the projects into todo, ongoing and done', () => {
        const projects = [
            newProject(),
            newProject({id: 'p2', ongoingTasks: ['t1']}),
            newProject({id: 'p3', completedTasks: ['t1']}),
            newProject({id: 'p4', closedAt: '2024-02-01T00:00:00.000Z'}),
        ];
        expect(deriveAgentSummary(newAgent(), projects).stats).toEqual({todo: 1, ongoing: 2, done: 1});
    });

    test('is idle without any open project', () => {
        expect(deriveAgentSummary(newAgent(), []).status).toBe('idle');
    });

    test('is idle when every project is done', () => {
        const projects = [newProject({closedAt: '2024-02-01T00:00:00.000Z'})];
        expect(deriveAgentSummary(newAgent(), projects)).toEqual({status: 'idle', stats: {todo: 0, ongoing: 0, done: 1}});
    });

    test('is busy while a project is still todo', () => {
        expect(deriveAgentSummary(newAgent(), [newProject()]).status).toBe('busy');
    });

    test('is busy while a project is ongoing', () => {
        expect(deriveAgentSummary(newAgent(), [newProject({ongoingTasks: ['t1']})]).status).toBe('busy');
    });

    test('reports a fired agent as fired but still counts the projects', () => {
        const summary = deriveAgentSummary(newAgent({fired: true}), [newProject({ongoingTasks: ['t1']})]);
        expect(summary).toEqual({status: 'fired', stats: {todo: 0, ongoing: 1, done: 0}});
    });
});

describe('app store', () => {

    beforeEach(() => {
        useAppStore.setState({
            agents: [],
            activeAgents: [],
            projects: [],
            messages: {},
            busyChatKeys: {},
            selectedAgentId: null,
            initializedChat: {},
        });
    });

    describe('browserId', () => {

        test('is a uuid generated once for the session', () => {
            expect(store().browserId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
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

    describe('updateProjectTask', () => {

        beforeEach(() => {
            store().setProjects([
                newProject({tasks: {'write tests': newTask(), 'ship it': newTask({title: 'ship it'})}}),
                newProject({id: 'p2'}),
            ]);
        });

        test('merges the patch into the task with that title', () => {
            store().updateProjectTask('p1', {title: 'write tests', status: 'ongoing', assignee: 'a1'});
            expect(store().getProjects()[0].tasks['write tests'])
                .toEqual(newTask({status: 'ongoing', assignee: 'a1'}));
        });

        test('leaves the other tasks of the project untouched', () => {
            const before = store().getProjects()[0].tasks['ship it'];
            store().updateProjectTask('p1', {title: 'write tests', status: 'done'});
            expect(store().getProjects()[0].tasks['ship it']).toBe(before);
        });

        test('leaves the other projects untouched', () => {
            const before = store().getProjects()[1];
            store().updateProjectTask('p1', {title: 'write tests', status: 'done'});
            expect(store().getProjects()[1]).toBe(before);
        });

        test('drops a task field that is patched with null', () => {
            store().updateProjectTask('p1', {title: 'write tests', assignee: 'a1'});
            store().updateProjectTask('p1', {title: 'write tests', assignee: null});
            expect(store().getProjects()[0].tasks['write tests']).not.toHaveProperty('assignee');
        });

        test('throws for an unknown project', () => {
            expect(() => store().updateProjectTask('ghost', {title: 'write tests'})).toThrow('Project not found.');
        });

        test('throws for an unknown task', () => {
            expect(() => store().updateProjectTask('p1', {title: 'ghost'})).toThrow('Task not found.');
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
});
