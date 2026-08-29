import {describe, expect, test} from 'vitest';
import {savedWords} from './use-editable-field';

/**
 * The holding of a draft is React's to run and there is no renderer here, so what is tested is
 * what the hook decides: which of the ways out of a box is a rewrite. Two pages share that answer
 * now, and both of them read it off this.
 */
describe('savedWords', () => {

    test('writes the new words down', () => {
        expect(savedWords('a shop that sells hats', 'a shop')).toBe('a shop that sells hats');
    });

    test('writes nothing for a box left as it was found', () => {
        expect(savedWords('a shop', 'a shop')).toBeNull();
    });

    /** Emptying the box is a way of closing it, not a way of erasing the field. */
    test('writes nothing for a box left empty', () => {
        expect(savedWords('', 'a shop')).toBeNull();
    });

    test('writes nothing for a box left with spaces in it', () => {
        expect(savedWords('   ', 'a shop')).toBeNull();
    });

    test('trims the words it writes down', () => {
        expect(savedWords('  a shop that sells hats  ', 'a shop')).toBe('a shop that sells hats');
    });

    /** Spaces are no rewrite either: what would be written is what is there already. */
    test('writes nothing for words that only gained spaces', () => {
        expect(savedWords('  a shop  ', 'a shop')).toBeNull();
    });
});
