import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentEmployee, INTERACTION_TIMEOUT, type Project} from '@deepclaw/core';
import type {SSEToastEvent} from '@/app/api/sse-types';
import {ToastService} from './toast-service';

const mocks = vi.hoisted(() => ({
    t: vi.fn<(key: string, params?: Record<string, string>) => string>(),
}));

vi.mock('@deepclaw/i18n', () => ({i18nInstance: {t: mocks.t}}));

function newAgent(overrides: Partial<AgentEmployee> = {}): AgentEmployee {
    return {
        id: 'a1',
        name: 'Ada',
        avatar: '🐋',
        role: 'engineer',
        personalities: [],
        emotion: false,
        expertises: [],
        fired: false,
        description: '',
        mood: 'none',
        ...overrides,
    };
}

function newProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 'p1',
        title: 'Ship it',
        description: '',
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

function pauseEvent(loopId: string): SSEToastEvent['content'] {
    return {key: 'interactionPause', data: loopId};
}

function paramsOf(key: string): Record<string, string> | undefined {
    return mocks.t.mock.calls.find(([called]) => called === key)?.[1];
}

function messageParams(): Record<string, string> | undefined {
    return paramsOf('web.toast.interactionPause.message');
}

describe('parseToastEvent', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.t.mockImplementation((key: string) => key);
    });

    test('builds a plain toast out of the key alone', () => {
        expect(ToastService.parseToastEvent({key: 'imConnected', data: 'Ada'}, [], [])).toEqual({
            title: 'web.toast.imConnected.title',
            message: 'web.toast.imConnected.message',
        });
    });

    test('hands the payload of a plain toast to its message', () => {
        ToastService.parseToastEvent({key: 'imConnectFailed', data: 'Ada'}, [], []);
        expect(paramsOf('web.toast.imConnectFailed.message')).toEqual({data: 'Ada'});
    });

    test('needs neither projects nor agents for a plain toast', () => {
        expect(() => ToastService.parseToastEvent({key: 'imConnected', data: 'Ada'}, [], [])).not.toThrow();
        expect(paramsOf('web.toast.imConnected.title')).toBeUndefined();
    });

    /** The toast is what the user has to come back to the question by, so it lasts as long as it. */
    test('keeps an interaction pause up for as long as the question waits', () => {
        expect(ToastService.parseToastEvent(pauseEvent('agent.a1'), [], [newAgent()]).duration)
            .toBe(INTERACTION_TIMEOUT);
    });

    test('lets a plain toast go away on its own', () => {
        expect(ToastService.parseToastEvent({key: 'imConnected', data: 'Ada'}, [], []).duration)
            .toBeUndefined();
    });

    test('titles an interaction pause with the shared title key', () => {
        const result = ToastService.parseToastEvent(pauseEvent('agent.a1'), [], [newAgent()]);
        expect(result.title).toBe('web.toast.interactionPause.title');
        expect(result.message).toBe('web.toast.interactionPause.message');
    });

    test('names the agent behind an agent loop', () => {
        ToastService.parseToastEvent(pauseEvent('agent.a1'), [], [newAgent()]);
        expect(messageParams()).toEqual({name: 'Ada', role: 'web.toast.interactionPause.role.agent'});
    });

    test('names the project behind a project loop', () => {
        ToastService.parseToastEvent(pauseEvent('project.a1.p1'), [newProject()], [newAgent()]);
        expect(messageParams()).toEqual({name: 'Ship it', role: 'web.toast.interactionPause.role.project'});
    });

    test('picks the project out of the list by its id', () => {
        const projects = [newProject({id: 'p0', title: 'Other'}), newProject({id: 'p1'})];
        ToastService.parseToastEvent(pauseEvent('project.a1.p1'), projects, []);
        expect(messageParams()?.name).toBe('Ship it');
    });

    test('picks the agent out of the list by its id', () => {
        const agents = [newAgent({id: 'a0', name: 'Grace'}), newAgent()];
        ToastService.parseToastEvent(pauseEvent('agent.a1'), [], agents);
        expect(messageParams()?.name).toBe('Ada');
    });

    test('falls back to the agent id when the agent is unknown', () => {
        ToastService.parseToastEvent(pauseEvent('agent.ghost'), [], [newAgent()]);
        expect(messageParams()).toEqual({name: 'ghost', role: 'web.toast.interactionPause.role.agent'});
    });

    test('falls back to the agent id and the agent role when the project is unknown', () => {
        ToastService.parseToastEvent(pauseEvent('project.a1.ghost'), [], [newAgent()]);
        expect(messageParams()).toEqual({name: 'a1', role: 'web.toast.interactionPause.role.agent'});
    });

    test('falls back to an empty name when the loop id carries no agent', () => {
        ToastService.parseToastEvent(pauseEvent('agent'), [], [newAgent()]);
        expect(messageParams()?.name).toBe('');
    });

    /** The toast is only worth a click where the page it would open has the chat of the loop on it. */
    test('takes the click of an agent loop to the agent page', () => {
        expect(ToastService.parseToastEvent(pauseEvent('agent.a1'), [], [newAgent()]).link)
            .toEqual({loopId: 'agent.a1', href: '/agents'});
    });

    test('takes the click of a project loop to that project', () => {
        expect(ToastService.parseToastEvent(pauseEvent('project.a1.p1'), [newProject()], []).link)
            .toEqual({loopId: 'project.a1.p1', href: '/projects?project=p1'});
    });

    test('escapes a project id the query string would not carry as it is', () => {
        const projects = [newProject({id: 'p 1&2'})];
        expect(ToastService.parseToastEvent(pauseEvent('project.a1.p 1&2'), projects, []).link?.href)
            .toBe('/projects?project=p%201%262');
    });

    test('leaves the toast to be read alone when the agent is unknown', () => {
        expect(ToastService.parseToastEvent(pauseEvent('agent.ghost'), [], [newAgent()]).link)
            .toBeUndefined();
    });

    test('leaves the toast to be read alone when the project is unknown', () => {
        expect(ToastService.parseToastEvent(pauseEvent('project.a1.ghost'), [], [newAgent()]).link)
            .toBeUndefined();
    });

    test('leaves the toast to be read alone when the loop id carries no agent', () => {
        expect(ToastService.parseToastEvent(pauseEvent('agent'), [], [newAgent()]).link).toBeUndefined();
    });

    test('leaves a plain toast nowhere to go', () => {
        expect(ToastService.parseToastEvent({key: 'imConnected', data: 'Ada'}, [], []).link)
            .toBeUndefined();
    });

    test('translates the role separately from the message', () => {
        mocks.t.mockImplementation((key: string, params?: Record<string, string>) => (
            params ? `${key}|${params.role}|${params.name}` : key.split('.').pop() ?? key
        ));
        const result = ToastService.parseToastEvent(pauseEvent('project.a1.p1'), [newProject()], []);
        expect(result.message).toBe('web.toast.interactionPause.message|project|Ship it');
    });
});
