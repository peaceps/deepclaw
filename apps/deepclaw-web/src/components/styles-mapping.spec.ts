import {describe, expect, test} from 'vitest';
import type {AgentEmployee, AgentStatus, ChatMessage, MissionPriority, MissionStatus, Project} from '@deepclaw/core';
import {
    avatarBG, getProjectStatusStyles, messageFlexStyles, messageTextStyles, messageTimeStyles,
    moodEmojis, priorityStyles, projectStatusStyles, statusColors,
} from './styles-mapping';

const STATUSES: MissionStatus[] = ['todo', 'ongoing', 'done'];
const PRIORITIES: MissionPriority[] = ['low', 'medium', 'high', 'urgent'];
const AGENT_STATUSES: AgentStatus[] = ['busy', 'idle', 'fired'];
const MOODS: AgentEmployee['mood'][] = ['happy', 'focused', 'tired', 'confused', 'none'];
const MESSAGE_TYPES: ChatMessage['type'][] = ['user', 'agent'];

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

describe('avatarBG', () => {

    test('is a tailwind gradient', () => {
        expect(avatarBG).toBe('bg-gradient-to-br from-amber-300 to-sky-300');
    });
});

describe('getProjectStatusStyles', () => {

    test('styles an untouched project as todo', () => {
        expect(getProjectStatusStyles(newProject())).toBe(projectStatusStyles.todo);
    });

    test('styles a project with ongoing tasks as ongoing', () => {
        expect(getProjectStatusStyles(newProject({ongoingTasks: ['t1']}))).toBe(projectStatusStyles.ongoing);
    });

    test('styles a project with completed tasks as ongoing while it stays open', () => {
        expect(getProjectStatusStyles(newProject({completedTasks: ['t1']}))).toBe(projectStatusStyles.ongoing);
    });

    test('styles a closed project as done', () => {
        const project = newProject({closedAt: '2024-02-01T00:00:00.000Z', ongoingTasks: ['t1']});
        expect(getProjectStatusStyles(project)).toBe(projectStatusStyles.done);
    });
});

describe('style maps', () => {

    test('projectStatusStyles covers every mission status', () => {
        expect(Object.keys(projectStatusStyles).sort()).toEqual([...STATUSES].sort());
    });

    test('priorityStyles covers every mission priority', () => {
        expect(Object.keys(priorityStyles).sort()).toEqual([...PRIORITIES].sort());
    });

    test('statusColors covers every agent status', () => {
        expect(Object.keys(statusColors).sort()).toEqual([...AGENT_STATUSES].sort());
    });

    test('moodEmojis covers every mood', () => {
        expect(Object.keys(moodEmojis).sort()).toEqual([...MOODS].sort());
    });

    test('every message map covers both message types', () => {
        for (const map of [messageFlexStyles, messageTextStyles, messageTimeStyles]) {
            expect(Object.keys(map).sort()).toEqual([...MESSAGE_TYPES].sort());
        }
    });

    test('tells the two message types apart in every message map', () => {
        for (const map of [messageFlexStyles, messageTextStyles, messageTimeStyles]) {
            expect(map.user).not.toBe(map.agent);
        }
    });

    test('gives each mission status its own background and text color', () => {
        expect(new Set(Object.values(projectStatusStyles)).size).toBe(STATUSES.length);
        for (const style of Object.values(projectStatusStyles)) {
            expect(style).toMatch(/^bg-\w+-100 text-\w+-700$/);
        }
    });

    test('gives each priority its own background and text color', () => {
        expect(new Set(Object.values(priorityStyles)).size).toBe(PRIORITIES.length);
        for (const style of Object.values(priorityStyles)) {
            expect(style).toMatch(/^bg-\w+-100 text-\w+-700$/);
        }
    });

    test('gives each agent status its own dot color', () => {
        expect(new Set(Object.values(statusColors)).size).toBe(AGENT_STATUSES.length);
        for (const color of Object.values(statusColors)) {
            expect(color).toMatch(/^bg-\w+-\d{3}$/);
        }
    });

    test('gives each mood its own emoji', () => {
        expect(new Set(Object.values(moodEmojis)).size).toBe(MOODS.length);
    });
});
