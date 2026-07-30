import {beforeEach, describe, expect, test, vi} from 'vitest';
import {en} from './en';
import {zh} from './zh';
import {initI18n} from './index';

const mocks = vi.hoisted(() => ({
    mergeResources: vi.fn<(resources: Record<string, unknown>) => void>(),
    init: vi.fn<(lang: string, middleware?: unknown) => void>(),
    initReactI18next: {type: '3rdParty', init: vi.fn()},
}));

vi.mock('@deepclaw/i18n', () => ({mergeResources: mocks.mergeResources, init: mocks.init}));

vi.mock('react-i18next', () => ({initReactI18next: mocks.initReactI18next}));

const mergedOnImport = mocks.mergeResources.mock.calls[0];

type Resource = Record<string, unknown>;

function leafPaths(node: unknown, prefix = ''): string[] {
    if (typeof node !== 'object' || node === null) {
        return [prefix];
    }
    return Object.entries(node as Resource)
        .flatMap(([key, value]) => leafPaths(value, prefix ? `${prefix}.${key}` : key));
}

function leaves(node: unknown, prefix = ''): [string, unknown][] {
    if (typeof node !== 'object' || node === null) {
        return [[prefix, node]];
    }
    return Object.entries(node as Resource)
        .flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
}

function placeholders(text: string): string[] {
    return [...text.matchAll(/{{(\w+)}}/g)].map(match => match[1]).sort();
}

describe('module setup', () => {

    test('registers the english and chinese resources while loading', () => {
        expect(mergedOnImport).toEqual([{en, zh}]);
    });
});

describe('initI18n', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('initializes the shared instance with the react middleware', () => {
        initI18n('zh');
        expect(mocks.init).toHaveBeenCalledWith('zh', mocks.initReactI18next);
    });

    test('passes an unsupported language through untouched', () => {
        initI18n('fr');
        expect(mocks.init).toHaveBeenCalledWith('fr', mocks.initReactI18next);
    });

    test('does not merge the resources again', () => {
        initI18n('en');
        expect(mocks.mergeResources).not.toHaveBeenCalled();
    });
});

describe('resources', () => {

    test('start from the same top level namespaces', () => {
        expect(Object.keys(zh)).toEqual(Object.keys(en));
    });

    test('translate exactly the same keys', () => {
        expect(leafPaths(zh).sort()).toEqual(leafPaths(en).sort());
    });

    test('translate every key into a non empty string', () => {
        for (const resource of [en, zh]) {
            for (const [path, value] of leaves(resource)) {
                expect(typeof value, path).toBe('string');
                expect((value as string).trim(), path).not.toBe('');
            }
        }
    });

    test('interpolate the same parameters in both languages', () => {
        const english = new Map(leaves(en).map(([path, value]) => [path, placeholders(value as string)]));
        for (const [path, value] of leaves(zh)) {
            expect(placeholders(value as string), path).toEqual(english.get(path));
        }
    });

    test('say something different in chinese than in english', () => {
        const english = new Map(leaves(en));
        const shared = leaves(zh).filter(([path, value]) => english.get(path) === value);
        expect(shared.length).toBeLessThan(leafPaths(en).length / 2);
    });
});
