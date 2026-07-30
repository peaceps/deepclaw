import {beforeEach, describe, expect, test, vi} from 'vitest';
import React from 'react';
import {Text} from 'ink';
import {render} from 'ink-testing-library';
import {type AgentInteractionEventPayload} from '@deepclaw/core';
import {useConfig} from './use-config';

type AgentEventHandler = (event: AgentInteractionEventPayload) => Promise<string>;

const mocks = vi.hoisted(() => ({
    validate: vi.fn<(handler: unknown) => Promise<void>>(),
}));

vi.mock('@deepclaw/config', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/config')>()),
    validateAndFixCurrentConfig: mocks.validate,
}));

function Probe({handler}: {handler: AgentEventHandler}): React.ReactElement {
    return React.createElement(Text, null, useConfig(handler) ? 'ready' : 'waiting');
}

function newHandler(): AgentEventHandler {
    return () => Promise.resolve('answer');
}

function renderProbe(handler: AgentEventHandler): ReturnType<typeof render> {
    return render(React.createElement(Probe, {handler}));
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.validate.mockResolvedValue(undefined);
});

describe('useConfig', () => {

    test('is not ready before the validation settled', () => {
        mocks.validate.mockReturnValue(new Promise<void>(() => undefined));
        expect(renderProbe(newHandler()).lastFrame()).toBe('waiting');
    });

    test('turns ready once the validation resolved', async () => {
        const {lastFrame} = renderProbe(newHandler());
        await vi.waitFor(() => expect(lastFrame()).toBe('ready'));
    });

    test('hands the agent event handler to the validation', () => {
        const handler = newHandler();
        renderProbe(handler);
        expect(mocks.validate).toHaveBeenCalledExactlyOnceWith(handler);
    });

    test('validates only once while the handler stays the same', async () => {
        const handler = newHandler();
        const {rerender, lastFrame} = renderProbe(handler);
        await vi.waitFor(() => expect(lastFrame()).toBe('ready'));
        rerender(React.createElement(Probe, {handler}));
        expect(mocks.validate).toHaveBeenCalledOnce();
    });

    test('validates again when the handler changes', async () => {
        const {rerender, lastFrame} = renderProbe(newHandler());
        await vi.waitFor(() => expect(lastFrame()).toBe('ready'));
        rerender(React.createElement(Probe, {handler: newHandler()}));
        expect(mocks.validate).toHaveBeenCalledTimes(2);
    });

    test('stays not ready while the validation never settles', async () => {
        mocks.validate.mockReturnValue(new Promise<void>(() => undefined));
        const {lastFrame} = renderProbe(newHandler());
        await vi.waitFor(() => expect(mocks.validate).toHaveBeenCalledOnce());
        expect(lastFrame()).toBe('waiting');
    });
});
