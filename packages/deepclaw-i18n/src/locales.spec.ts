import {afterEach, describe, expect, test, vi} from 'vitest';
import {DEFAULT_LANG, ISO639_1_LOCALE_MAP, LANG_BCP47_LOCALE_MAP} from './locales';
import {SUPPORTED_LANGUAGES} from './supported-languages';

async function defaultLangForLocale(locale: string) {
    vi.resetModules();
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
        resolvedOptions: () => ({locale}),
    } as unknown as Intl.DateTimeFormat);
    return (await import('./locales')).DEFAULT_LANG;
}

describe('locale maps', () => {

    test('the BCP47 map covers exactly the supported languages', () => {
        expect(Object.keys(LANG_BCP47_LOCALE_MAP).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
    });

    test('the ISO639-1 map covers exactly the supported languages', () => {
        expect(Object.keys(ISO639_1_LOCALE_MAP).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
    });

    test('every BCP47 locale starts with its language key', () => {
        for (const lang of SUPPORTED_LANGUAGES) {
            expect(LANG_BCP47_LOCALE_MAP[lang].startsWith(lang)).toBe(true);
        }
    });

    test('every BCP47 locale carries a region', () => {
        for (const lang of SUPPORTED_LANGUAGES) {
            expect(LANG_BCP47_LOCALE_MAP[lang]).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
        }
    });
});

describe('DEFAULT_LANG', () => {

    afterEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
    });

    test('is always a supported language', () => {
        expect(SUPPORTED_LANGUAGES).toContain(DEFAULT_LANG);
    });

    test('follows the runtime locale when it is supported', async () => {
        expect(await defaultLangForLocale('zh-CN')).toBe('zh');
        expect(await defaultLangForLocale('en-US')).toBe('en');
    });

    test('matches on the language part alone', async () => {
        expect(await defaultLangForLocale('zh')).toBe('zh');
    });

    test('falls back to the first supported language for an unknown locale', async () => {
        expect(await defaultLangForLocale('fr-FR')).toBe(SUPPORTED_LANGUAGES[0]);
    });
});
