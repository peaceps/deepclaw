import {describe, expect, test} from 'vitest';
import {loadConfig} from './app-config';

describe('config-utils', () => {

    test('returns undefined for missing keys', () => {
        expect(loadConfig<string | undefined>('agent.not.exists')).toBeUndefined();
        expect(loadConfig<string | undefined>('ui.theme')).toBeUndefined();
    });
});
