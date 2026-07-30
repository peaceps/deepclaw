import {describe, expect, test} from 'vitest';
import {formatDate, handleUpdateRecordContent, handleUpdatedArrayContent, translateCron} from './component-utils';

type Item = {id: string; name: string; count: number; note?: string};

const SEED = '2024-03-05T09:07:00.000Z';

function newItem(overrides: Partial<Item> = {}): Item {
    return {id: 'i1', name: 'first', count: 1, ...overrides};
}

function localeDate(locale: string): string {
    return new Date(SEED).toLocaleDateString(locale, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

describe('formatDate', () => {

    test('renders an iso string in the locale of the language', () => {
        expect(formatDate('en', SEED)).toBe(localeDate('en-US'));
        expect(formatDate('zh', SEED)).toBe(localeDate('zh-CN'));
    });

    test('renders month, day, hour and minute', () => {
        expect(formatDate('en', SEED)).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}/);
    });

    test('tells the languages apart', () => {
        expect(formatDate('en', SEED)).not.toBe(formatDate('zh', SEED));
    });

    test('accepts an epoch in milliseconds', () => {
        expect(formatDate('en', new Date(SEED).getTime())).toBe(localeDate('en-US'));
    });

    test('falls back to the first supported language for an unknown one', () => {
        expect(formatDate('fr', SEED)).toBe(formatDate('en', SEED));
    });

    test('returns a dash without a date seed', () => {
        expect(formatDate('en')).toBe('-');
        expect(formatDate('en', '')).toBe('-');
    });

    test('returns a dash for the epoch because zero is falsy', () => {
        expect(formatDate('en', 0)).toBe('-');
    });

    test('renders an unparsable seed as an invalid date', () => {
        expect(formatDate('en', 'not a date')).toBe('Invalid Date');
    });
});

describe('translateCron', () => {

    test('describes an expression in english', () => {
        expect(translateCron('en', '0 0 * * *')).toBe('At 12:00 AM');
        expect(translateCron('en', '*/5 * * * *')).toBe('Every 5 minutes');
    });

    test('describes an expression in chinese', () => {
        expect(translateCron('zh', '0 0 * * *')).toBe('在上午 12:00');
    });

    test('throws for an expression it cannot parse', () => {
        expect(() => translateCron('en', 'not a cron')).toThrow();
    });
});

describe('handleUpdatedArrayContent', () => {

    test('appends content whose id is unknown', () => {
        expect(handleUpdatedArrayContent([newItem()], newItem({id: 'i2', name: 'second'})))
            .toEqual([newItem(), newItem({id: 'i2', name: 'second'})]);
    });

    test('merges a patch into the item with the same id', () => {
        expect(handleUpdatedArrayContent([newItem()], {id: 'i1', count: 9}))
            .toEqual([newItem({count: 9})]);
    });

    test('leaves the other items untouched', () => {
        const others = [newItem({id: 'i2'})];
        const next = handleUpdatedArrayContent([newItem(), ...others], {id: 'i1', count: 9});
        expect(next[1]).toBe(others[0]);
    });

    test('drops a field that is patched with null', () => {
        expect(handleUpdatedArrayContent([newItem({note: 'keep'})], {id: 'i1', note: null}))
            .toEqual([newItem()]);
    });

    test('never overwrites the key itself', () => {
        const [merged] = handleUpdatedArrayContent([newItem()], {id: 'i1'});
        expect(merged).toEqual(newItem());
    });

    test('removes the item with the matching id when deleted', () => {
        expect(handleUpdatedArrayContent([newItem(), newItem({id: 'i2'})], {id: 'i1'}, true))
            .toEqual([newItem({id: 'i2'})]);
    });

    test('deletes nothing when the id is unknown', () => {
        expect(handleUpdatedArrayContent([newItem()], {id: 'ghost'}, true)).toEqual([newItem()]);
    });

    test('matches on a custom key instead of the id', () => {
        const rows = [{title: 'a', value: 1}, {title: 'b', value: 2}];
        expect(handleUpdatedArrayContent(rows, {title: 'b', value: 20}, false, 'title'))
            .toEqual([{title: 'a', value: 1}, {title: 'b', value: 20}]);
    });

    test('returns a new array without changing the previous one', () => {
        const prev = [newItem()];
        const next = handleUpdatedArrayContent(prev, {id: 'i1', count: 9});
        expect(next).not.toBe(prev);
        expect(prev[0]).toEqual(newItem());
    });

    test('takes a patch as the whole item when it is appended', () => {
        expect(handleUpdatedArrayContent<Item>([], {id: 'i2', count: 3})).toEqual([{id: 'i2', count: 3}]);
    });
});

describe('handleUpdateRecordContent', () => {

    test('adds an entry under the id when it is unknown', () => {
        expect(handleUpdateRecordContent<Item>({}, newItem())).toEqual({i1: newItem()});
    });

    test('merges a patch into the existing entry', () => {
        expect(handleUpdateRecordContent({i1: newItem()}, {id: 'i1', count: 9}))
            .toEqual({i1: newItem({count: 9})});
    });

    test('keeps the other entries', () => {
        const prev = {i1: newItem(), i2: newItem({id: 'i2'})};
        expect(handleUpdateRecordContent(prev, {id: 'i1', count: 9}).i2).toBe(prev.i2);
    });

    test('drops a field that is patched with null', () => {
        expect(handleUpdateRecordContent({i1: newItem({note: 'keep'})}, {id: 'i1', note: null}))
            .toEqual({i1: newItem()});
    });

    test('removes the entry when deleted', () => {
        expect(handleUpdateRecordContent({i1: newItem(), i2: newItem({id: 'i2'})}, {id: 'i1'}, true))
            .toEqual({i2: newItem({id: 'i2'})});
    });

    test('deletes nothing when the id is unknown', () => {
        expect(handleUpdateRecordContent({i1: newItem()}, {id: 'ghost'}, true)).toEqual({i1: newItem()});
    });

    test('keys entries by a custom key instead of the id', () => {
        const rows = {a: {title: 'a', value: 1}};
        expect(handleUpdateRecordContent(rows, {title: 'a', value: 20}, false, 'title'))
            .toEqual({a: {title: 'a', value: 20}});
    });

    test('returns a new record without changing the previous one', () => {
        const prev = {i1: newItem()};
        const next = handleUpdateRecordContent(prev, {id: 'i1', count: 9});
        expect(next).not.toBe(prev);
        expect(prev.i1).toEqual(newItem());
    });

    test('takes a patch as the whole entry when it is added', () => {
        expect(handleUpdateRecordContent<Item>({}, {id: 'i2', count: 3})).toEqual({i2: {id: 'i2', count: 3}});
    });
});
