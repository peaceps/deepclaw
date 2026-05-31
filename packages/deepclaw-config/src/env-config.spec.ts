import process from 'node:process';
import {afterEach, describe, expect, test} from 'vitest';
import {getEnvVariable, hasEnvVariable} from './env-config';

describe('env-config', () => {
    const envName = 'DEEPCLAW_TEST_ENV';

    afterEach(() => {
        delete process.env[envName];
    });

    test('hasEnvVariable detects existing env key', () => {
        process.env[envName] = '';
        expect(hasEnvVariable(envName)).toBe(true);
    });

    test('hasEnvVariable returns false for missing env key', () => {
        expect(hasEnvVariable(envName)).toBe(false);
    });

    test('getEnvVariable returns empty string when missing', () => {
        expect(getEnvVariable(envName)).toBe('');
    });

    test('getEnvVariable returns value when present', () => {
        process.env[envName] = 'enabled';
        expect(getEnvVariable(envName)).toBe('enabled');
    });
});
