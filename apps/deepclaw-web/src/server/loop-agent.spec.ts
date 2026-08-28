import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type ChatMessage, type ImageContent, type TokenUsage} from '@deepclaw/core';
import {
    activeLoop, getTokenUsage, inactiveLoop, invoke, pullNewerMessages, pullOlderMessages,
    pushChatMessage, resolveInteraction,
} from './loop-agent';

const mocks = vi.hoisted(() => ({
    watchLoop: vi.fn<(browserId: string, loopId: string, watching: boolean) => void>(),
    invoke: vi.fn<(
        loopInfo: {role: string; agentId: string; projectId: string},
        options: {source: string; browserId: string; images?: ImageContent[]},
        input: string
    ) => {busy: boolean; msgId: string}>(),
    getTokenUsage: vi.fn<(loopId: string) => TokenUsage | undefined>(),
    resolveInteraction: vi.fn<(browserId: string, loopId: string, answer: string) => boolean>(),
    addMessage: vi.fn<(browserId: string, loopId: string, message: ChatMessage) => void>(),
    updateMessage: vi.fn<(browserId: string, loopId: string, id: string, text: string) => void>(),
    getOlderMessages: vi.fn<(loopId: string, endMessageId?: string) => ChatMessage[]>(),
    getNewerMessages: vi.fn<(loopId: string, startMessageId?: string) => ChatMessage[]>(),
}));

vi.mock('@/app/api/sse-server', () => ({SSEServer: {watchLoop: mocks.watchLoop}}));

vi.mock('@deepclaw/loop-gateway', () => ({
    LoopGateway: {
        invoke: mocks.invoke,
        getTokenUsage: mocks.getTokenUsage,
        resolveInteraction: mocks.resolveInteraction,
        addMessage: mocks.addMessage,
        updateMessage: mocks.updateMessage,
    },
    UIChatService: {
        getOlderMessages: mocks.getOlderMessages,
        getNewerMessages: mocks.getNewerMessages,
    },
}));

function newMessage(id = 'm1'): ChatMessage {
    return {id, agentId: 'a1', content: 'hi', type: 'agent', timestamp: '2026-01-01T00:00:00.000Z'};
}

const USAGE: TokenUsage = {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3};

beforeEach(() => {
    vi.resetAllMocks();
});

describe('invoke', () => {

    test('runs the input in the loop of that agent and project on behalf of the browser', async () => {
        mocks.invoke.mockReturnValue({busy: false, msgId: 'm1'});
        await expect(invoke('b1', 'project', 'a1', 'p1', 'hi')).resolves.toEqual({busy: false, msgId: 'm1'});
        expect(mocks.invoke).toHaveBeenCalledWith(
            {role: 'project', agentId: 'a1', projectId: 'p1'}, {source: 'web', browserId: 'b1'}, 'hi'
        );
    });

    test('passes the images of the browser along with the input', async () => {
        mocks.invoke.mockReturnValue({busy: false, msgId: 'm1'});
        const images = [{url: 'data:image/png;base64,QUJD', mediaType: 'image/png'}];
        await invoke('b1', 'agent', 'a1', '', 'look', images);
        expect(mocks.invoke.mock.calls[0]![1].images).toEqual(images);
    });

    test('marks every invocation as coming from the web', async () => {
        mocks.invoke.mockReturnValue({busy: false, msgId: 'm1'});
        await invoke('b1', 'agent', 'a1', '', 'hi');
        expect(mocks.invoke.mock.calls[0]![1]).toEqual({source: 'web', browserId: 'b1'});
    });

    test('reports a loop that is still busy', async () => {
        mocks.invoke.mockReturnValue({busy: true, msgId: 'm2'});
        await expect(invoke('b1', 'agent', 'a1', '', 'hi')).resolves.toEqual({busy: true, msgId: 'm2'});
    });
});

describe('activeLoop', () => {

    test('starts watching the loop of that browser', async () => {
        await activeLoop('b1', 'agent.a1');
        expect(mocks.watchLoop).toHaveBeenCalledWith('b1', 'agent.a1', true);
    });
});

describe('inactiveLoop', () => {

    test('stops watching the loop of that browser', async () => {
        await inactiveLoop('b1', 'agent.a1');
        expect(mocks.watchLoop).toHaveBeenCalledWith('b1', 'agent.a1', false);
    });
});

describe('getTokenUsage', () => {

    test('reads the usage of the loop', async () => {
        mocks.getTokenUsage.mockReturnValue(USAGE);
        await expect(getTokenUsage('agent.a1')).resolves.toEqual(USAGE);
        expect(mocks.getTokenUsage).toHaveBeenCalledWith('agent.a1');
    });

    test('stays undefined for a loop without a session', async () => {
        await expect(getTokenUsage('agent.a1')).resolves.toBeUndefined();
    });
});

describe('resolveInteraction', () => {

    test('hands the answer to the waiting loop', async () => {
        mocks.resolveInteraction.mockReturnValue(true);
        await expect(resolveInteraction('b1', 'agent.a1', 'Ada')).resolves.toBe(true);
        expect(mocks.resolveInteraction).toHaveBeenCalledWith('b1', 'agent.a1', 'Ada');
    });

    test('reports that nobody was waiting for an answer', async () => {
        mocks.resolveInteraction.mockReturnValue(false);
        await expect(resolveInteraction('b1', 'agent.a1', 'Ada')).resolves.toBe(false);
    });
});

describe('message paging', () => {

    test('pulls the page before the given message', async () => {
        const messages = [newMessage()];
        mocks.getOlderMessages.mockReturnValue(messages);
        await expect(pullOlderMessages('agent.a1', 'm9')).resolves.toBe(messages);
        expect(mocks.getOlderMessages).toHaveBeenCalledWith('agent.a1', 'm9');
    });

    test('pulls the newest page when no message is named', async () => {
        mocks.getOlderMessages.mockReturnValue([]);
        await pullOlderMessages('agent.a1');
        expect(mocks.getOlderMessages).toHaveBeenCalledWith('agent.a1', undefined);
    });

    test('pulls the page after the given message', async () => {
        const messages = [newMessage('m2')];
        mocks.getNewerMessages.mockReturnValue(messages);
        await expect(pullNewerMessages('agent.a1', 'm1')).resolves.toBe(messages);
        expect(mocks.getNewerMessages).toHaveBeenCalledWith('agent.a1', 'm1');
    });

    test('pulls from the start when no message is named', async () => {
        mocks.getNewerMessages.mockReturnValue([]);
        await pullNewerMessages('agent.a1');
        expect(mocks.getNewerMessages).toHaveBeenCalledWith('agent.a1', undefined);
    });
});

describe('chat messages', () => {

    test('pushes a message on behalf of the browser that wrote it', async () => {
        const message = newMessage();
        await pushChatMessage('b1', 'agent.a1', message);
        expect(mocks.addMessage).toHaveBeenCalledWith('b1', 'agent.a1', message);
    });
});
