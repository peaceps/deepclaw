import {beforeEach, describe, expect, test, vi} from 'vitest';
import {en} from '../i18n/en';
import {zh} from '../i18n/zh';

const mocks = vi.hoisted(() => ({
    mergeResources: vi.fn<(resources: Record<string, unknown>) => void>(),
    init: vi.fn<(lang: string) => void>(),
    loadLang: vi.fn<() => string>(),
}));

vi.mock('@deepclaw/i18n', () => ({mergeResources: mocks.mergeResources, init: mocks.init}));

vi.mock('@deepclaw/config', () => ({loadLang: mocks.loadLang}));

async function load(): Promise<void> {
    vi.resetModules();
    await import('./index');
}

function mergedResources(): Record<string, unknown> {
    return mocks.mergeResources.mock.calls[0]![0];
}

beforeEach(() => {
    vi.resetAllMocks();
    mocks.loadLang.mockReturnValue('en');
});

describe('i18n-server', () => {

    test('registers the english and the chinese bundle', async () => {
        await load();
        expect(mocks.mergeResources).toHaveBeenCalledOnce();
        expect(Object.keys(mergedResources())).toEqual(['en', 'zh']);
    });

    test('registers the bundles the app ships', async () => {
        await load();
        expect(mergedResources()).toEqual({en, zh});
    });

    test('ships the server meta strings in both languages', async () => {
        await load();
        expect(en.server.meta.title).toBeTruthy();
        expect(zh.server.meta.title).toBeTruthy();
    });

    test('initializes with the configured language', async () => {
        mocks.loadLang.mockReturnValue('zh');
        await load();
        expect(mocks.init).toHaveBeenCalledWith('zh');
    });

    test('registers the bundles before initializing', async () => {
        await load();
        expect(mocks.mergeResources.mock.invocationCallOrder[0]!)
            .toBeLessThan(mocks.init.mock.invocationCallOrder[0]!);
    });
});
