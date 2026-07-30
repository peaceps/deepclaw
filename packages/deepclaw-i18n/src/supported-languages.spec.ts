import {describe, expect, test} from 'vitest';
import {FULL_NAME_MAP, SUPPORTED_LANGUAGES} from './supported-languages';

describe('SUPPORTED_LANGUAGES', () => {

    test('is not empty so it can provide a fallback language', () => {
        expect(SUPPORTED_LANGUAGES.length).toBeGreaterThan(0);
    });

    test('has no duplicates', () => {
        expect(new Set(SUPPORTED_LANGUAGES).size).toBe(SUPPORTED_LANGUAGES.length);
    });
});

describe('FULL_NAME_MAP', () => {

    test('covers exactly the supported languages', () => {
        expect(Object.keys(FULL_NAME_MAP).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
    });

    test('names every language with a non empty label', () => {
        for (const lang of SUPPORTED_LANGUAGES) {
            expect(FULL_NAME_MAP[lang]).toBeTruthy();
        }
    });
});
