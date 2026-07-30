import {afterEach, describe, expect, test} from 'vitest';
import {globalize} from './globalize';

const KEY_A = 'globalizeSpecA';
const KEY_B = 'globalizeSpecB';
const globalStore = globalThis as unknown as Record<string, unknown>;

describe('globalize', () => {

    afterEach(() => {
        delete globalStore[`__${KEY_A}`];
        delete globalStore[`__${KEY_B}`];
    });

    test('returns the given value on the first registration', () => {
        expect(globalize(KEY_A, {id: 1})).toEqual({id: 1});
    });

    test('stores the value on globalThis under a prefixed key', () => {
        const value = {id: 'stored'};
        globalize(KEY_A, value);
        expect(globalStore[`__${KEY_A}`]).toBe(value);
    });

    test('returns the first registered instance for the same key', () => {
        const first = {id: 'first'};
        globalize(KEY_A, first);
        expect(globalize(KEY_A, {id: 'second'})).toBe(first);
    });

    test('keeps different keys independent', () => {
        globalize(KEY_A, 'a');
        expect(globalize(KEY_B, 'b')).toBe('b');
    });

    test('keeps a falsy but non-nullish registered value', () => {
        globalize(KEY_A, 0);
        expect(globalize(KEY_A, 42)).toBe(0);
    });

    test('registers again when the stored value is nullish', () => {
        globalize(KEY_A, undefined);
        expect(globalize(KEY_A, 'later')).toBe('later');
    });
});
