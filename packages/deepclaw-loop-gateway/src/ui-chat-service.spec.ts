import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type ChatMessage} from '@deepclaw/core';
import {PAGE_SIZE, UIChatService} from './ui-chat-service';

const mocks = vi.hoisted(() => ({
    readFile: vi.fn<(path: string) => string>(),
    appendFile: vi.fn<(path: string, content: string) => void>(),
    writeFile: vi.fn<(path: string, content: string) => string>(() => ''),
    exists: vi.fn<(path: string) => boolean>(() => false),
    movePath: vi.fn<(from: string, to: string) => boolean>(() => false),
    warn: vi.fn<(message: string) => void>(),
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
        readFile: mocks.readFile, appendFile: mocks.appendFile, writeFile: mocks.writeFile,
        exists: mocks.exists, movePath: mocks.movePath,
    },
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn()}),
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

    /**
     * The empty message an answer is opened with is written by whatever is said next, so the answer
     * that fills it in is a change to a line the file already has. An append writes nothing for
     * that -- everything past the end of the file is nothing -- and the answer would be on the page
     * until the conversation was read back off the disk without it.
     */
    test('writes the file again for a change to a message it has already written', () => {
        UIChatService.addMessage('agent.rewrite', newMessage('m1', ''));
        UIChatService.addMessage('agent.rewrite', newMessage('m2'));
        vi.clearAllMocks();
        UIChatService.replaceMessage('agent.rewrite', 'm1', 'the answer');
        expect(mocks.appendFile).not.toHaveBeenCalled();
        expect(mocks.writeFile).toHaveBeenCalledExactlyOnceWith(
            '.agents/rewrite/session/chat.jsonl',
            `${JSON.stringify(newMessage('m1', 'the answer'))}\n${JSON.stringify(newMessage('m2'))}\n`
        );
    });

    /** Everything past the end of the file is unwritten for a reason, the empty message included. */
    test('appends a message that is not written yet rather than writing the file again', () => {
        UIChatService.addMessage('agent.stillAppends', newMessage('m1'));
        UIChatService.addMessage('agent.stillAppends', newMessage('m2', ''));
        vi.clearAllMocks();
        UIChatService.replaceMessage('agent.stillAppends', 'm2', 'the answer');
        expect(mocks.writeFile).not.toHaveBeenCalled();
        expect(mocks.appendFile).toHaveBeenCalledExactlyOnceWith(
            '.agents/stillAppends/session/chat.jsonl',
            `${JSON.stringify(newMessage('m2', 'the answer'))}\n`
        );
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

/**
 * Opening a chat is what puts it here, and opening one builds no loop, so nothing above this can
 * say when a conversation stops being worth holding. Nothing here counts what is in the store
 * either: it is static and holds whatever the tests above left in it, which can only bring an
 * eviction closer. What says a conversation was let go of is having to be read off the disk again.
 */
describe('UIChatService letting go of idle conversations', () => {
    const MAX_LIVE_CHATS = 12;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readFile.mockImplementation(() => {
            throw new Error('not found');
        });
    });

    /** Every wave opens conversations of its own, so that none of them is a chat already held. */
    function openChats(count: number, wave: string): void {
        Array.from({length: count}, (_, i) => UIChatService.getOlderMessages(`agent.${wave}${i}`));
    }

    test('lets go of the conversation nobody has opened in the longest', () => {
        UIChatService.addMessage('agent.walkedPast', newMessage('m1'));
        openChats(MAX_LIVE_CHATS, 'past');
        expect(UIChatService.getOlderMessages('agent.walkedPast')).toEqual([]);
    });

    /** Said in it or only read, either one is somebody being in that conversation just now. */
    test('puts a conversation back at the end of the queue when it is used again', () => {
        UIChatService.addMessage('agent.usedAgain', newMessage('m1'));
        openChats(MAX_LIVE_CHATS, 'before');
        // Let go of by the walk above, and here again: what it holds now is this message alone.
        UIChatService.addMessage('agent.usedAgain', newMessage('m2'));
        // A few rather than a storeful: what is asked here is whether using it again moved it out
        // of the way of the next eviction, and how many the store has room for depends on what the
        // tests above left in it, a conversation with something unwritten in it never leaving.
        openChats(4, 'after');
        expect(ids(UIChatService.getOlderMessages('agent.usedAgain'))).toEqual(['m2']);
    });

    /**
     * The empty message an answer is opened with is the one thing here the disk cannot give back,
     * and an answer whose message is gone by the time it arrives is an answer nobody ever reads.
     */
    test('keeps a conversation holding a message that is not written yet', () => {
        UIChatService.addMessage('agent.unwritten', newMessage('m1', ''));
        openChats(MAX_LIVE_CHATS * 2, 'crowd');
        expect(ids(UIChatService.getOlderMessages('agent.unwritten'))).toEqual(['m1']);
    });
});

/**
 * The three things a conversation holds go together or not at all, and letting go of one is the
 * first thing that ever asks whether they really do: what is read back has to be the conversation
 * as it was, a cursor handed out before has to still find its place in it, and the count of what is
 * already written has to come back as the file rather than as whatever it was before.
 */
describe('UIChatService reading back a conversation it let go of', () => {
    const MAX_LIVE_CHATS = 12;
    const disk = new Map<string, string>();

    beforeEach(() => {
        vi.clearAllMocks();
        disk.clear();
        mocks.readFile.mockImplementation(path => {
            const file = disk.get(path);
            if (file === undefined) {
                throw new Error('not found');
            }
            return file;
        });
        mocks.appendFile.mockImplementation((path, content) => {
            disk.set(path, (disk.get(path) ?? '') + content);
        });
    });

    /**
     * Enough other conversations to push the one under test out of the store. What they read on
     * their way in is cleared off after them, so that a read of the file under test past this point
     * is that conversation being read back -- which is the only thing here that says it was ever
     * let go of. Without asking for it, all of these would pass just as well against a store that
     * had quietly stopped letting go of anything.
     */
    function crowdOut(): void {
        Array.from({length: MAX_LIVE_CHATS}, (_, i) => UIChatService.getOlderMessages(`agent.out${i}`));
        mocks.readFile.mockClear();
    }

    test('reads it back as it was', () => {
        const written = fill('agent.backAsWas', 3);
        crowdOut();
        expect(UIChatService.getOlderMessages('agent.backAsWas')).toEqual(written);
        expect(mocks.readFile).toHaveBeenCalledExactlyOnceWith('.agents/backAsWas/session/chat.jsonl');
    });

    /**
     * The cursors go with the messages, so the page asked for from one is found by walking the
     * conversation that was read back rather than by a place remembered from before it was let go.
     */
    test('pages on from a cursor it was handed before', () => {
        fill('agent.backPage', PAGE_SIZE + 5);
        const page = UIChatService.getOlderMessages('agent.backPage');
        crowdOut();
        expect(ids(UIChatService.getOlderMessages('agent.backPage', page[0]!.id)))
            .toEqual(idRange(1, 5));
        expect(mocks.readFile).toHaveBeenCalledExactlyOnceWith('.agents/backPage/session/chat.jsonl');
    });

    /**
     * The count of what is written goes with them too, and comes back as the length of the file:
     * anything else and the next message either lands in the middle of it or repeats the whole of
     * it.
     */
    test('writes only the new message to the file, not the conversation again', () => {
        fill('agent.backAppend', 2);
        crowdOut();
        const message = newMessage('m3');
        UIChatService.addMessage('agent.backAppend', message);
        expect(mocks.readFile).toHaveBeenCalledExactlyOnceWith('.agents/backAppend/session/chat.jsonl');
        expect(mocks.appendFile.mock.calls.at(-1)).toEqual([
            '.agents/backAppend/session/chat.jsonl', `${JSON.stringify(message)}\n`
        ]);
        expect(disk.get('.agents/backAppend/session/chat.jsonl')).toBe(
            [newMessage('m1'), newMessage('m2'), message].map(m => `${JSON.stringify(m)}\n`).join('')
        );
    });
});

/**
 * Nothing is done about a conversation that has grown big -- the whole of it is still read to show
 * the last page of it -- but being let go of makes that a thing paid on every opening rather than
 * once for as long as the program runs, so the day it starts to hurt is worth knowing about.
 */
describe('UIChatService reporting a conversation that has grown big', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readFile.mockImplementation(() => {
            throw new Error('not found');
        });
    });

    test('says so in the log for a conversation of more messages than anybody meant to keep', () => {
        mocks.readFile.mockReturnValueOnce(`${JSON.stringify(newMessage('m1'))}\n`.repeat(20001));
        UIChatService.getOlderMessages('agent.huge');
        expect(mocks.warn).toHaveBeenCalledOnce();
        expect(mocks.warn.mock.calls[0]![0]).toContain('agent.huge');
    });

    test('says nothing of a conversation of an ordinary size', () => {
        mocks.readFile.mockReturnValueOnce(`${JSON.stringify(newMessage('m1'))}\n`);
        UIChatService.getOlderMessages('agent.ordinary');
        expect(mocks.warn).not.toHaveBeenCalled();
    });
});

/**
 * A storeful of conversations that cannot be let go of leaves the walk nothing to drop until it
 * reaches the end of the queue -- and the end of the queue is the conversation just read in, which
 * is the one thing the caller is about to use. Dropped there, the caller is handed a conversation
 * that is no longer in the store: an empty page where a chat should be, or nothing to push the
 * next message onto at all.
 *
 * The twelve need not be twelve runs going at once. One run that stops partway through an answer
 * leaves behind the empty message it opened with, never to be filled, and that conversation is
 * held from then until somebody speaks in it again -- so they gather over days.
 *
 * Last of this file: what it pins is pinned for the rest of the run, leaving no room in the store
 * for anything after it.
 */
describe('UIChatService with a storeful of conversations it cannot let go of', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readFile.mockImplementation(() => {
            throw new Error('not found');
        });
    });

    test('keeps the conversation it has just read in', () => {
        Array.from({length: 12}, (_, i) => {
            UIChatService.addMessage(`agent.pinned${i}`, newMessage('m1', ''));
        });
        UIChatService.addMessage('agent.arrivedLast', newMessage('m1'));
        expect(ids(UIChatService.getOlderMessages('agent.arrivedLast'))).toEqual(['m1']);
    });
});
