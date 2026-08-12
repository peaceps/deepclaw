import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type ChatMessage} from '@deepclaw/core';
import {UIChatService} from './ui-chat-service';

const mocks = vi.hoisted(() => ({
    readFile: vi.fn<(path: string) => string>(),
    appendFile: vi.fn(),
    saveImage: vi.fn<(bytes: Buffer, extension: string, loopId: string) => string>(
        (_bytes, extension, loopId) => `${loopId}/abc123.${extension}`
    ),
}));

vi.mock('@deepclaw/agent', () => ({
    AGENTS_DIR: '.agents',
    PROJECT_DIR: '.projects',
    CHAT_FILE: 'chat.jsonl',
}));

vi.mock('@deepclaw/node-utils', () => ({
    FileUtils: {readFile: mocks.readFile, appendFile: mocks.appendFile},
    ImageStore: {save: mocks.saveImage},
}));

function newMessage(id: string, content = `text of ${id}`): ChatMessage {
    return {id, agentId: 'a1', content, type: 'user', timestamp: '2026-01-01T00:00:00.000Z'};
}

function fill(loopId: string, count: number): ChatMessage[] {
    const messages = Array.from({length: count}, (_, i) => newMessage(`m${i + 1}`));
    messages.forEach(message => UIChatService.addMessage(loopId, message));
    return messages;
}

function ids(messages: ChatMessage[]): string[] {
    return messages.map(message => message.id);
}

describe('UIChatService message store', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readFile.mockImplementation(() => {
            throw new Error('not found');
        });
    });

    test('keeps an added message and persists it as one json line', () => {
        const message = newMessage('m1');
        UIChatService.addMessage('agent.add', message);
        expect(ids(UIChatService.getOlderMessages('agent.add'))).toEqual(['m1']);
        expect(mocks.appendFile).toHaveBeenCalledWith('.agents/add/chat.jsonl', `${JSON.stringify(message)}\n`);
    });

    test('writes a reference into the chat file instead of the bytes of an image', () => {
        const message = {...newMessage('m1'), images: [{url: 'data:image/png;base64,QUJD', mediaType: 'image/png'}]};
        UIChatService.addMessage('agent.image', message);
        expect(mocks.saveImage).toHaveBeenCalledExactlyOnceWith(Buffer.from('ABC'), 'png', 'agent.image');
        expect(mocks.appendFile).toHaveBeenCalledWith('.agents/image/chat.jsonl', `${JSON.stringify({
            ...message, images: [{url: 'dcimg://agent.image/abc123.png', mediaType: 'image/png'}]
        })}\n`);
    });

    test('persists a message that carries nothing but images', () => {
        UIChatService.addMessage('agent.only-image', {
            ...newMessage('m1', ''), images: [{url: 'data:image/png;base64,QUJD', mediaType: 'image/png'}]
        });
        expect(mocks.appendFile).toHaveBeenCalledOnce();
    });

    test('holds back an empty message until it has content', () => {
        UIChatService.addMessage('agent.empty', newMessage('m1', ''));
        expect(ids(UIChatService.getOlderMessages('agent.empty'))).toEqual(['m1']);
        expect(mocks.appendFile).not.toHaveBeenCalled();
    });

    test('replaces the content of a known message and persists it', () => {
        UIChatService.addMessage('agent.replace', newMessage('m1', ''));
        const replaced = UIChatService.replaceMessage('agent.replace', 'm1', 'final answer');
        expect(replaced?.content).toBe('final answer');
        expect(mocks.appendFile).toHaveBeenCalledOnce();
    });

    test('ignores a replacement of an unknown message', () => {
        UIChatService.addMessage('agent.unknown', newMessage('m1'));
        vi.clearAllMocks();
        expect(UIChatService.replaceMessage('agent.unknown', 'nope', 'text')).toBeUndefined();
        expect(mocks.appendFile).not.toHaveBeenCalled();
    });

    test('appends only the messages that are not persisted yet', () => {
        mocks.readFile.mockReturnValueOnce([
            JSON.stringify(newMessage('p1')), JSON.stringify(newMessage('p2'))
        ].join('\n'));
        const message = newMessage('m3');
        UIChatService.addMessage('agent.incremental', message);
        expect(mocks.appendFile).toHaveBeenCalledExactlyOnceWith(
            '.agents/incremental/chat.jsonl', `${JSON.stringify(message)}\n`
        );
    });
});

describe('UIChatService persistence', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readFile.mockImplementation(() => {
            throw new Error('not found');
        });
    });

    test('loads the persisted messages on first access', () => {
        mocks.readFile.mockReturnValueOnce([
            JSON.stringify(newMessage('p1')), JSON.stringify(newMessage('p2'))
        ].join('\n'));
        expect(ids(UIChatService.getOlderMessages('agent.load'))).toEqual(['p1', 'p2']);
    });

    test('skips blank and malformed lines', () => {
        mocks.readFile.mockReturnValueOnce(
            `${JSON.stringify(newMessage('p1'))}\n\n   \nnot json\n${JSON.stringify(newMessage('p2'))}\n`
        );
        expect(ids(UIChatService.getOlderMessages('agent.malformed'))).toEqual(['p1', 'p2']);
    });

    test('starts empty when there is no chat file', () => {
        expect(UIChatService.getOlderMessages('agent.missing')).toEqual([]);
    });

    test('reads the file only once per loop', () => {
        UIChatService.getOlderMessages('agent.once');
        UIChatService.getOlderMessages('agent.once');
        expect(mocks.readFile).toHaveBeenCalledOnce();
    });

    test('stores an agent chat next to the agent', () => {
        UIChatService.getOlderMessages('agent.a1');
        expect(mocks.readFile).toHaveBeenCalledWith('.agents/a1/chat.jsonl');
    });

    test('stores a project chat next to the project', () => {
        UIChatService.getOlderMessages('project.a1.p1');
        expect(mocks.readFile).toHaveBeenCalledWith('.projects/p1/chat.jsonl');
    });
});

describe('UIChatService pagination', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readFile.mockImplementation(() => {
            throw new Error('not found');
        });
    });

    test('returns the last page when no cursor is given', () => {
        fill('agent.older', 15);
        expect(ids(UIChatService.getOlderMessages('agent.older'))).toEqual([
            'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14', 'm15'
        ]);
    });

    test('returns the page right before the cursor', () => {
        fill('agent.olderPage', 15);
        expect(ids(UIChatService.getOlderMessages('agent.olderPage', 'm6')))
            .toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    });

    test('returns nothing older than the very first message', () => {
        fill('agent.olderStart', 15);
        expect(UIChatService.getOlderMessages('agent.olderStart', 'm1')).toEqual([]);
    });

    test('returns nothing for an unknown older cursor', () => {
        fill('agent.olderUnknown', 15);
        expect(UIChatService.getOlderMessages('agent.olderUnknown', 'nope')).toEqual([]);
    });

    test('returns everything when asking for newer messages without a cursor', () => {
        fill('agent.newer', 15);
        expect(UIChatService.getNewerMessages('agent.newer')).toHaveLength(15);
    });

    test('returns only the messages after the cursor', () => {
        fill('agent.newerPage', 15);
        expect(ids(UIChatService.getNewerMessages('agent.newerPage', 'm13'))).toEqual(['m14', 'm15']);
    });

    test('returns nothing newer than the last message', () => {
        fill('agent.newerEnd', 15);
        expect(UIChatService.getNewerMessages('agent.newerEnd', 'm15')).toEqual([]);
    });

    test('returns nothing for an unknown newer cursor', () => {
        fill('agent.newerUnknown', 15);
        expect(UIChatService.getNewerMessages('agent.newerUnknown', 'nope')).toEqual([]);
    });

    test('pages backwards through the whole history', () => {
        fill('agent.walk', 25);
        const last = UIChatService.getOlderMessages('agent.walk');
        const middle = UIChatService.getOlderMessages('agent.walk', last[0]!.id);
        const first = UIChatService.getOlderMessages('agent.walk', middle[0]!.id);
        expect(ids(last).concat(ids(middle), ids(first))).toHaveLength(25);
        expect(first[0]!.id).toBe('m1');
        expect(UIChatService.getOlderMessages('agent.walk', first[0]!.id)).toEqual([]);
    });

    test('serves a newly added message to a client that already saw the older ones', () => {
        fill('agent.live', 3);
        const seen = UIChatService.getOlderMessages('agent.live');
        UIChatService.addMessage('agent.live', newMessage('m4'));
        expect(ids(UIChatService.getNewerMessages('agent.live', seen[seen.length - 1]!.id))).toEqual(['m4']);
    });
});
