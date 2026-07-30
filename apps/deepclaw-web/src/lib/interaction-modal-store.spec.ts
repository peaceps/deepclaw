import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {AgentInteractionEventPayload} from '@deepclaw/core';
import {useInteractionModalStore} from './interaction-modal-store';

function newEvent(overrides: Partial<AgentInteractionEventPayload> = {}): AgentInteractionEventPayload {
    return {type: 'input', content: 'What is the deploy target?', ...overrides} as AgentInteractionEventPayload;
}

function store(): ReturnType<typeof useInteractionModalStore.getState> {
    return useInteractionModalStore.getState();
}

describe('useInteractionModalStore', () => {

    beforeEach(() => {
        useInteractionModalStore.setState({
            visible: false,
            event: null,
            loopId: null,
            instanceId: 0,
            resolve: null,
        });
    });

    describe('showModal', () => {

        test('opens the modal with the event and its loop', () => {
            store().showModal('agent.a1', newEvent());
            expect(store()).toMatchObject({visible: true, loopId: 'agent.a1', event: newEvent()});
        });

        test('keeps the promise pending while the modal is open', async () => {
            const settled = vi.fn();
            store().showModal('agent.a1', newEvent()).then(settled);
            await Promise.resolve();
            expect(settled).not.toHaveBeenCalled();
        });

        test('counts every opened modal', () => {
            store().showModal('agent.a1', newEvent());
            store().showModal('agent.a1', newEvent());
            expect(store().instanceId).toBe(2);
        });

        test('replaces the event of an open modal', () => {
            store().showModal('agent.a1', newEvent());
            store().showModal('project.a1.p1', newEvent({content: 'Approve the plan?'}));
            expect(store()).toMatchObject({loopId: 'project.a1.p1', event: {content: 'Approve the plan?'}});
        });

        test('carries the options of a select interaction', () => {
            const event = newEvent({type: 'select', options: ['yes', 'no']});
            store().showModal('agent.a1', event);
            expect(store().event).toEqual(event);
        });
    });

    describe('closeModal', () => {

        test('resolves the pending promise with the answer', async () => {
            const answer = store().showModal('agent.a1', newEvent());
            store().closeModal('production');
            await expect(answer).resolves.toBe('production');
        });

        test('resolves with null when the modal was cancelled', async () => {
            const answer = store().showModal('agent.a1', newEvent());
            store().closeModal(null);
            await expect(answer).resolves.toBeNull();
        });

        test('hides the modal and forgets the event', () => {
            store().showModal('agent.a1', newEvent());
            store().closeModal('production');
            expect(store()).toMatchObject({visible: false, event: null, loopId: null, resolve: null});
        });

        test('keeps counting the instances across a close', () => {
            store().showModal('agent.a1', newEvent());
            store().closeModal(null);
            store().showModal('agent.a1', newEvent());
            expect(store().instanceId).toBe(2);
        });

        test('does nothing without an open modal', () => {
            expect(() => store().closeModal('production')).not.toThrow();
            expect(store().visible).toBe(false);
        });

        test('resolves only once even when closed twice', async () => {
            const answer = store().showModal('agent.a1', newEvent());
            store().closeModal('first');
            store().closeModal('second');
            await expect(answer).resolves.toBe('first');
        });

        test('leaves the first promise pending when a second modal took over', async () => {
            const settled = vi.fn();
            store().showModal('agent.a1', newEvent()).then(settled);
            const second = store().showModal('agent.a1', newEvent());
            store().closeModal('answer');
            await expect(second).resolves.toBe('answer');
            expect(settled).not.toHaveBeenCalled();
        });
    });
});
