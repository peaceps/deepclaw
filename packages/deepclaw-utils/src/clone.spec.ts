import {describe, expect, test} from 'vitest';
import {clone, mergeAbsence} from './clone';

describe('clone', () => {

    test('deep copies nested objects so the source stays untouched', () => {
        const source = {name: 'deepclaw', nested: {level: 1}};
        const cloned = clone(source);
        cloned.nested.level = 2;
        expect(source.nested.level).toBe(1);
        expect(cloned).toEqual({name: 'deepclaw', nested: {level: 2}});
    });

    test('deep copies objects inside arrays', () => {
        const source = {items: [{id: 'a'}, {id: 'b'}]};
        const cloned = clone(source);
        cloned.items[0]!.id = 'changed';
        expect(source.items[0]!.id).toBe('a');
        expect(cloned.items[1]).toEqual({id: 'b'});
    });

    test('applies converter to primitive leaves at every depth', () => {
        const source = {content: 'hint', nested: {content: 'inner', keep: 'as-is'}};
        const cloned = clone(source, (key, value) => key === 'content' ? `web.${value}` : value);
        expect(cloned).toEqual({content: 'web.hint', nested: {content: 'web.inner', keep: 'as-is'}});
    });

    test('passes the array key to the converter for primitive elements', () => {
        const cloned = clone({tags: ['a', 'b']}, (key, value) => `${key}:${value}`);
        expect(cloned.tags).toEqual(['tags:a', 'tags:b']);
    });
});

describe('mergeAbsence', () => {

    test('fills only the absent keys and keeps the existing ones', () => {
        type Sample = {a: string, b?: string};
        const target: Sample = {a: 'kept'};
        expect(mergeAbsence(target, {a: 'fallback', b: 'filled'})).toEqual({a: 'kept', b: 'filled'});
    });

    test('keeps falsy target values that are not nullish', () => {
        const target = {count: 0, flag: false, text: ''};
        expect(mergeAbsence(target, {count: 9, flag: true, text: 'fallback'}))
            .toEqual({count: 0, flag: false, text: ''});
    });

    test('replaces null target values from the source', () => {
        type Nullable = {value: string | null};
        const target: Nullable = {value: null};
        expect(mergeAbsence(target, {value: 'filled'})).toEqual({value: 'filled'});
    });

    test('keeps an existing array untouched', () => {
        type WithList = {list: string[]};
        const target: WithList = {list: ['keep']};
        expect(mergeAbsence(target, {list: ['a', 'b']}).list).toEqual(['keep']);
    });

    test('creates the missing nested object before merging into it', () => {
        type Nested = {outer?: {inner: string}};
        const target: Nested = {};
        expect(mergeAbsence(target, {outer: {inner: 'value'}})).toEqual({outer: {inner: 'value'}});
    });

    test('replaces a primitive target with an object when the source holds an object', () => {
        const target = {outer: 'primitive'} as unknown as {outer: {inner: string}};
        expect(mergeAbsence(target, {outer: {inner: 'value'}})).toEqual({outer: {inner: 'value'}});
    });

    test('mutates and returns the same target reference', () => {
        const target = {} as {a: string};
        expect(mergeAbsence(target, {a: 'x'})).toBe(target);
        expect(target.a).toBe('x');
    });
});
