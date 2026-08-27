import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type ChatMessage} from '@deepclaw/core';
import {PAGE_SIZE, UIChatService} from './ui-chat-service';

const mocks = vi.hoisted(() => ({
    readFile: vi.fn<(path: string) => string>(),
    appendFile: vi.fn(),
    exists: vi.fn<(path: string) => boolean>(() => false),
    movePath: vi.fn<(from: string, to: string) => boolean>(() => false),
    saveImage: vi.fn<(bytes: Buffer, extension: string, loopId: string) => string>(
        (_bytes, extension, loopId) => `${loopId}/abc123.${extension}`
    ),
}));

/** The same folders the real one names, without the disk underneath them. */
vi.mock('@deepclaw/agent', () => ({
    AGENTS_DIR: '.agents',
    PROJECT_DIR: '.projects',
    CHAT_FILE: 'chat.jsonl',
    SessionService: {
        getLoopSessionDir: (loopId: string) => {
            const [, agentId, projectId] = loopId.split('.');
            return !projectId ? `.agents/${agentId}/session` : `.projects/${projectId}/session`;
        },
        getArchivedSessionDir: (loopId: string, sessionId: string) => {
            const [, agentId, projectId] = loopId.split('.');
            const root = !projectId ? `.agents/${agentId}` : `.projects/${projectId}`;
            return `${root}/archived/${sessionId}`;
        },
    },
}));

vi.mock('@deepclaw/node-utils', () => ({
    FileUtils: {
        readFile: mocks.readFile, appendFile: mocks.appendFile,
        exists: mocks.exists, movePath: mocks.movePath,
    },
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

/** The ids of m{from} through m{to}, which is what a page of that stretch comes back as. */
function idRange(from: number, to: number): string[] {
    return Array.from({length: to - from + 1}, (_, i) => `m${from + i}`);
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
        expect(mocks.appendFile).toHaveBeenCalledWith('.agents/add/session/chat.jsonl', `${JSON.stringify(message)}\n`);
    });

    test('writes a reference into the chat file instead of the bytes of an image', () => {
        const message = {...newMessage('m1'), images: [{url: 'data:image/png;base64,QUJD', mediaType: 'image/png'}]};
        UIChatService.addMessage('agent.image', message);
        expect(mocks.saveImage).toHaveBeenCalledExactlyOnceWith(Buffer.from('ABC'), 'png', 'agent.image');
        expect(mocks.appendFile).toHaveBeenCalledWith('.agents/image/session/chat.jsonl', `${JSON.stringify({
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
            '.agents/incremental/session/chat.jsonl', `${JSON.stringify(message)}\n`
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

    test('stores an agent chat in the session it belongs to', () => {
        UIChatService.getOlderMessages('agent.a1');
        expect(mocks.readFile).toHaveBeenCalledWith('.agents/a1/session/chat.jsonl');
    });

    test('stores a project chat in the session it belongs to', () => {
        UIChatService.getOlderMessages('project.a1.p1');
        expect(mocks.readFile).toHaveBeenCalledWith('.projects/p1/session/chat.jsonl');
    });

    /** Its session folder goes with the run, and its log is a conversation nobody opens. */
    test('leaves the log of a cron run where it always was', () => {
        UIChatService.getOlderMessages('cron.a1.c1');
        expect(mocks.readFile).toHaveBeenCalledWith('.projects/c1/chat.jsonl');
        expect(mocks.movePath).not.toHaveBeenCalled();
    });

    test('reads a conversation that was closed out of the folder it was moved to', () => {
        UIChatService.getOlderMessages('agent.a1', undefined, '20260101000000000');
        expect(mocks.readFile).toHaveBeenCalledWith(
            '.agents/a1/archived/20260101000000000/chat.jsonl'
        );
    });

    test('moves a log left beside the session into it', () => {
        UIChatService.getOlderMessages('agent.legacy');
        expect(mocks.movePath).toHaveBeenCalledExactlyOnceWith(
            '.agents/legacy/chat.jsonl', '.agents/legacy/session/chat.jsonl'
        );
    });

    test('leaves a log that already sits in the session alone', () => {
        mocks.exists.mockReturnValueOnce(true);
        UIChatService.getOlderMessages('agent.moved');
        expect(mocks.movePath).not.toHaveBeenCalled();
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
        fill('agent.older', PAGE_SIZE + 5);
        expect(ids(UIChatService.getOlderMessages('agent.older')))
            .toEqual(idRange(6, PAGE_SIZE + 5));
    });

    test('returns the page right before the cursor', () => {
        fill('agent.olderPage', PAGE_SIZE + 5);
        expect(ids(UIChatService.getOlderMessages('agent.olderPage', 'm6')))
            .toEqual(idRange(1, 5));
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

    test('returns the cursor along with the messages after it', () => {
        fill('agent.newerPage', 15);
        expect(ids(UIChatService.getNewerMessages('agent.newerPage', 'm13')))
            .toEqual(['m13', 'm14', 'm15']);
    });

    /** The caller may hold it as it was being written, so it is worth having again whole. */
    test('returns the last message itself when nothing came after it', () => {
        fill('agent.newerEnd', 15);
        expect(ids(UIChatService.getNewerMessages('agent.newerEnd', 'm15'))).toEqual(['m15']);
    });

    test('returns nothing for an unknown newer cursor', () => {
        fill('agent.newerUnknown', 15);
        expect(UIChatService.getNewerMessages('agent.newerUnknown', 'nope')).toEqual([]);
    });

    test('pages backwards through the whole history', () => {
        const total = PAGE_SIZE * 2 + 5;
        fill('agent.walk', total);
        const last = UIChatService.getOlderMessages('agent.walk');
        const middle = UIChatService.getOlderMessages('agent.walk', last[0]!.id);
        const first = UIChatService.getOlderMessages('agent.walk', middle[0]!.id);
        expect(ids(last).concat(ids(middle), ids(first))).toHaveLength(total);
        expect(first[0]!.id).toBe('m1');
        expect(UIChatService.getOlderMessages('agent.walk', first[0]!.id)).toEqual([]);
    });

    test('serves a newly added message to a client that already saw the older ones', () => {
        fill('agent.live', 3);
        const seen = UIChatService.getOlderMessages('agent.live');
        UIChatService.addMessage('agent.live', newMessage('m4'));
        expect(ids(UIChatService.getNewerMessages('agent.live', seen[seen.length - 1]!.id)))
            .toEqual(['m3', 'm4']);
    });

    /** What a client left half written and stopped hearing about is what it comes back for. */
    test('hands back the message as it stands now', () => {
        fill('agent.finished', 2);
        UIChatService.replaceMessage('agent.finished', 'm2', 'the whole answer');
        expect(UIChatService.getNewerMessages('agent.finished', 'm2')[0]?.content)
            .toBe('the whole answer');
    });
});

describe('UIChatService forgetting a conversation', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readFile.mockImplementation(() => {
            throw new Error('not found');
        });
    });

    test('holds nothing of the conversation it forgot', () => {
        fill('agent.forgotten', 3);
        UIChatService.forget('agent.forgotten');
        expect(UIChatService.getOlderMessages('agent.forgotten')).toEqual([]);
    });

    /**
     * The count of what was already written has to be forgotten along with the messages. Kept, it
     * would name a place in a file that is no longer there, and everything written before that
     * point would be skipped over and never land on disk at all.
     */
    test('writes the first message of the next conversation from the start of the file', () => {
        fill('agent.persistIndex', 3);
        UIChatService.forget('agent.persistIndex');
        vi.clearAllMocks();
        mocks.readFile.mockImplementation(() => {
            throw new Error('not found');
        });
        const message = newMessage('n1');
        UIChatService.addMessage('agent.persistIndex', message);
        expect(mocks.appendFile).toHaveBeenCalledExactlyOnceWith(
            '.agents/persistIndex/session/chat.jsonl', `${JSON.stringify(message)}\n`
        );
    });

    test('forgets the cursors of the conversation it forgot', () => {
        fill('agent.cursors', PAGE_SIZE + 5);
        const page = UIChatService.getOlderMessages('agent.cursors');
        UIChatService.forget('agent.cursors');
        expect(UIChatService.getOlderMessages('agent.cursors', page[0]!.id)).toEqual([]);
    });

    /** A project can be talked to by more than one agent, and all of it is written in one folder. */
    test('holds nothing of any conversation of the project it forgot', () => {
        fill('project.a1.p-gone', 2);
        fill('project.a2.p-gone', 2);
        fill('project.a1.p-stays', 2);
        UIChatService.forgetProject('p-gone');
        expect(UIChatService.getOlderMessages('project.a1.p-gone')).toEqual([]);
        expect(UIChatService.getOlderMessages('project.a2.p-gone')).toEqual([]);
        expect(ids(UIChatService.getOlderMessages('project.a1.p-stays'))).toEqual(['m1', 'm2']);
    });

    /**
     * The count of what was written is the half worth forgetting, and a conversation that was only
     * read holds it without any loop being held anywhere: kept, the next message would land in the
     * middle of a file that has moved away.
     */
    test('writes from the start of the file after the project it was in was forgotten', () => {
        fill('project.a1.p-index', 3);
        UIChatService.forgetProject('p-index');
        vi.clearAllMocks();
        mocks.readFile.mockImplementation(() => {
            throw new Error('not found');
        });
        const message = newMessage('n1');
        UIChatService.addMessage('project.a1.p-index', message);
        expect(mocks.appendFile).toHaveBeenCalledExactlyOnceWith(
            '.projects/p-index/session/chat.jsonl', `${JSON.stringify(message)}\n`
        );
    });

    /** An agent chat carries no project, and every project it ever spoke about is somebody else's. */
    test('leaves the chats that belong to no project alone', () => {
        fill('agent.a1', 2);
        UIChatService.forgetProject('p-gone');
        expect(ids(UIChatService.getOlderMessages('agent.a1'))).toEqual(['m1', 'm2']);
    });

    /** Reading one back is not talking in it, so what the live chat holds is left as it was. */
    test('keeps the live conversation while one that was closed is read', () => {
        fill('agent.both', 2);
        UIChatService.getOlderMessages('agent.both', undefined, '20260101000000000');
        expect(ids(UIChatService.getOlderMessages('agent.both'))).toEqual(['m1', 'm2']);
    });

    /**
     * One live conversation per loop is a bounded thing to hold. One more for every conversation
     * anybody ever opens is not, and a transcript nobody will add to is no cheaper to keep in
     * memory than to read again.
     */
    test('lets go of a conversation that was closed once the page is out', () => {
        mocks.readFile.mockReturnValue(`${JSON.stringify(newMessage('a1'))}\n`);
        UIChatService.getOlderMessages('agent.reread', undefined, '20260101000000000');
        UIChatService.getOlderMessages('agent.reread', undefined, '20260101000000000');
        expect(mocks.readFile).toHaveBeenCalledTimes(2);
    });

    test('pages back through a conversation it is not holding on to', () => {
        const messages = Array.from({length: PAGE_SIZE + 5}, (_, i) => newMessage(`a${i + 1}`));
        mocks.readFile.mockReturnValue(messages.map(m => `${JSON.stringify(m)}\n`).join(''));
        const last = UIChatService.getOlderMessages('agent.page', undefined, '20260101000000000');
        expect(ids(UIChatService.getOlderMessages('agent.page', last[0]!.id, '20260101000000000')))
            .toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
    });
});
