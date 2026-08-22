import {describe, expect, test} from 'vitest';
import {keepReply} from './kept-reply';

/** What a call of it writes down, which is nothing at all when it writes nothing. */
function kept(held?: string, streamed?: string): string[] {
    const written: string[] = [];
    keepReply(held, streamed, text => written.push(text));
    return written;
}

describe('keepReply', () => {

    test('keeps what the tab read of a run that streamed', () => {
        expect(kept('Hello', 'Hello')).toEqual(['Hello']);
    });

    /** The chunks were nowhere but the tab, so the fuller reading wins over the last round alone. */
    test('keeps what was read over what the run ended with', () => {
        expect(kept('the whole answer, chunk by chunk', 'the last round only'))
            .toEqual(['the whole answer, chunk by chunk']);
    });

    /**
     * What the first report of this was: a call turned away for a key short of its cost had its
     * error kept as an empty message, and an empty message is read as a run still thinking.
     */
    test('falls back to the text of a run that streamed nothing', () => {
        expect(kept('', 'ERROR: 403 Free quota exhausted.')).toEqual(['ERROR: 403 Free quota exhausted.']);
        expect(kept(undefined, 'ERROR: 403 Free quota exhausted.')).toEqual(['ERROR: 403 Free quota exhausted.']);
    });

    /** Writing this down would say the run answered with silence, over whatever it did answer. */
    test('writes nothing down when there is nothing on either side', () => {
        expect(kept('', '')).toEqual([]);
        expect(kept(undefined, undefined)).toEqual([]);
    });
});
