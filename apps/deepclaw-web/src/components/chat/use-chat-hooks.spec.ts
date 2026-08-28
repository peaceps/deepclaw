import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {ChatMessage} from '@deepclaw/core';
import {pullMessagesFrom} from './use-chat-hooks';

/**
 * The asking itself is React's to run and there is no renderer here: what is tested is what the
 * hook decides, which is which of the two ways of asking a chat is caught up with. Reading the
 * module pulls in the server it asks, and reading that pulls in the whole of the gateway behind it.
 */
const mocks = vi.hoisted(() => ({
    pullNewerMessages: vi.fn<(loopId: string, startMessageId?: string) => Promise<ChatMessage[]>>(),
    pullOlderMessages: vi.fn<(loopId: string, endMessageId?: string) => Promise<ChatMessage[]>>(),
    warn: vi.fn<(message: string) => void>(),
}));

vi.mock('@/lib/logger', () => ({
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn()}),
}));

vi.mock('@/server/loop-agent', () => ({
    pullNewerMessages: mocks.pullNewerMessages,
    pullOlderMessages: mocks.pullOlderMessages,
    invoke: vi.fn(),
    pushChatMessage: vi.fn(),
    resolveInteraction: vi.fn(),
    activeLoop: vi.fn(),
    inactiveLoop: vi.fn(),
    getTokenUsage: vi.fn(),
    pullSessionMessages: vi.fn(),
    startNewSession: vi.fn(),
    stopLoop: vi.fn(),
}));

function newMessage(id: string): ChatMessage {
    return {id, agentId: 'a1', content: `text of ${id}`, type: 'user', timestamp: '2026-01-01T00:00:00.000Z'};
}

describe('pullMessagesFrom', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.pullOlderMessages.mockResolvedValue([newMessage('last page')]);
        mocks.pullNewerMessages.mockResolvedValue([newMessage('from the cursor')]);
    });

    test('asks for the last page of a chat that holds nothing yet', async () => {
        expect(await pullMessagesFrom('agent.a1')).toEqual([newMessage('last page')]);
        expect(mocks.pullNewerMessages).not.toHaveBeenCalled();
    });

    test('carries on from the newest message the page holds', async () => {
        expect(await pullMessagesFrom('agent.a1', 'm9')).toEqual([newMessage('from the cursor')]);
        expect(mocks.pullNewerMessages).toHaveBeenCalledExactlyOnceWith('agent.a1', 'm9');
        expect(mocks.pullOlderMessages).not.toHaveBeenCalled();
        expect(mocks.warn).not.toHaveBeenCalled();
    });

    /**
     * A cursor comes back with the message it names, so nothing at all is not "nothing new": it is
     * a message the server cannot place. Left at that, the chat would ask from it forever and never
     * be handed another word said in that conversation.
     */
    test('asks for the last page instead when the cursor cannot be placed', async () => {
        mocks.pullNewerMessages.mockResolvedValue([]);
        expect(await pullMessagesFrom('agent.a1', 'ghost')).toEqual([newMessage('last page')]);
        expect(mocks.pullOlderMessages).toHaveBeenCalledExactlyOnceWith('agent.a1');
    });

    /**
     * The page it falls back to is the last one and no further, so anything said between the two is
     * left out and the join does not show. Rare enough to live with and too dear to close from
     * here, but not a thing to have happen without a word said about it anywhere.
     */
    test('says in the log that it fell back, and from which message', async () => {
        mocks.pullNewerMessages.mockResolvedValue([]);
        await pullMessagesFrom('agent.a1', 'ghost');
        expect(mocks.warn).toHaveBeenCalledOnce();
        expect(mocks.warn.mock.calls[0]![0]).toContain('ghost');
    });
});
