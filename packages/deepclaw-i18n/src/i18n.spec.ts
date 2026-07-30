import {beforeAll, describe, expect, test, vi} from 'vitest';
import {i18nInstance, initFn, mergeResourcesFn, parseArrayI18n} from './i18n';

describe('i18n', () => {

    beforeAll(() => {
        mergeResourcesFn({
            en: {greeting: 'hello', list: 'a,b,c', single: 'only', withParam: 'hi {{name}}'},
            zh: {greeting: '你好'},
        });
        initFn('en');
    });

    test('initializes the shared instance with the resources merged before init', () => {
        expect(i18nInstance.isInitialized).toBe(true);
        expect(i18nInstance.t('greeting')).toBe('hello');
    });

    test('adds resources into an instance that is already initialized', () => {
        mergeResourcesFn({en: {late: 'late value'}});
        expect(i18nInstance.t('late')).toBe('late value');
    });

    test('keeps the resources of each language apart', async () => {
        await i18nInstance.changeLanguage('zh');
        expect(i18nInstance.t('greeting')).toBe('你好');
        await i18nInstance.changeLanguage('en');
        expect(i18nInstance.t('greeting')).toBe('hello');
    });

    test('interpolates parameters without escaping them', () => {
        expect(i18nInstance.t('withParam', {name: '<b>'})).toBe('hi <b>');
    });

    test('switches the language when init is called again', () => {
        initFn('zh');
        expect(i18nInstance.language).toBe('zh');
        initFn('en');
        expect(i18nInstance.language).toBe('en');
    });

    test('runs the middleware init even when the instance is already initialized', () => {
        const middleware = {type: '3rdParty' as const, init: vi.fn()};
        initFn('en', middleware);
        expect(middleware.init).toHaveBeenCalledWith(i18nInstance);
    });
});

describe('parseArrayI18n', () => {

    test('splits a comma separated translation', () => {
        expect(parseArrayI18n('list')).toEqual(['a', 'b', 'c']);
    });

    test('wraps a single value into an array', () => {
        expect(parseArrayI18n('single')).toEqual(['only']);
    });

    test('returns the key itself when there is no translation', () => {
        expect(parseArrayI18n('missing.key')).toEqual(['missing.key']);
    });
});
