import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {AgentEmployee, Project} from '@deepclaw/core';
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

function messageParams(): Record<string, string> | undefined {
    const call = mocks.t.mock.calls.find(([key]) => key === 'web.toast.interactionPause.message');
    return call?.[1];
}

describe('parseToastEvent', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.t.mockImplementation((key: string) => key);
    });

    test('renders nothing for a key it does not know', () => {
        expect(ToastService.parseToastEvent({key: 'somethingElse', data: 'agent.a1'}, [], []))
            .toEqual({title: '', message: ''});
        expect(mocks.t).not.toHaveBeenCalled();
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

    test('translates the role separately from the message', () => {
        mocks.t.mockImplementation((key: string, params?: Record<string, string>) => (
            params ? `${key}|${params.role}|${params.name}` : key.split('.').pop() ?? key
        ));
        const result = ToastService.parseToastEvent(pauseEvent('project.a1.p1'), [newProject()], []);
        expect(result.message).toBe('web.toast.interactionPause.message|project|Ship it');
    });
});
