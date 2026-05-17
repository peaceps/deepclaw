import {describe, expect, test} from '@jest/globals';
import {loadAgentConfig, loadUIConfig} from './app-config-utils';

describe('config-utils', () => {
    test('loads configured agent values', () => {
        expect(loadAgentConfig<number>('llmRetry')).toBe(3);
    });

    test('returns undefined for missing keys', () => {
        expect(loadAgentConfig<string | undefined>('not.exists')).toBeUndefined();
        expect(loadUIConfig<string | undefined>('theme')).toBeUndefined();
    });
});
