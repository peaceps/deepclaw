import {describe, expect, test} from 'vitest';
import {loadConfig} from './app-config-utils';

describe('config-utils', () => {
    test('loads configured agent values', () => {
        expect(loadConfig<'transient' | 'persisted' | 'ask'>('agent.standaloneTask')).toBe('transient');
    });

    test('returns undefined for missing keys', () => {
        expect(loadConfig<string | undefined>('agent.not.exists')).toBeUndefined();
        expect(loadConfig<string | undefined>('ui.theme')).toBeUndefined();
    });
});
