import {describe, expect, test, vi} from 'vitest';
import {en} from './en';
import {zh} from './zh';

const mocks = vi.hoisted(() => ({
    middleware: {type: '3rdParty'},
    mergeResources: vi.fn<(resources: Record<string, unknown>) => void>(),
    init: vi.fn<(lang: string, middleware: unknown) => void>(),
    loadLang: vi.fn<() => string>(() => 'zh'),
}));

vi.mock('react-i18next', () => ({initReactI18next: mocks.middleware}));

vi.mock('@deepclaw/i18n', () => ({mergeResources: mocks.mergeResources, init: mocks.init}));

vi.mock('@deepclaw/config', () => ({loadLang: mocks.loadLang}));

function leafPaths(value: unknown, prefix = ''): string[] {
    if (typeof value !== 'object' || value === null) {
        return [prefix];
    }
    return Object.entries(value).flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
}

function leaf(bundle: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[key], bundle);
}

function placeholders(text: unknown): string[] {
    return [...String(text).matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]!).sort();
}

describe('tui translations', () => {

    test('registers both languages when it is loaded', async () => {
        await import('./index');
        expect(mocks.mergeResources).toHaveBeenCalledExactlyOnceWith({en, zh});
    });

    test('starts i18next in the configured language with the react middleware', async () => {
        await import('./index');
        expect(mocks.loadLang).toHaveBeenCalledOnce();
        expect(mocks.init).toHaveBeenCalledExactlyOnceWith('zh', mocks.middleware);
    });

    test('translates every english key into chinese', () => {
        const english = leafPaths(en);
        const chinese = leafPaths(zh);
        expect(english.filter(path => !chinese.includes(path))).toEqual([]);
        expect(chinese.filter(path => !english.includes(path))).toEqual([]);
    });

    test('keeps the same placeholders in both languages', () => {
        for (const path of leafPaths(en)) {
            expect(placeholders(leaf(zh, path)), `placeholders of ${path}`)
                .toEqual(placeholders(leaf(en, path)));
        }
    });

    test('leaves no translation empty', () => {
        for (const bundle of [en, zh]) {
            for (const path of leafPaths(bundle)) {
                expect(String(leaf(bundle, path)).trim(), `translation of ${path}`).not.toBe('');
            }
        }
    });
});
