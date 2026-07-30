import process from 'node:process';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {cleanupOnShutdown} from './graceful-shutdown';

describe('cleanupOnShutdown', () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    let exitCodes: number[] = [];

    beforeEach(() => {
        handlers.clear();
        exitCodes = [];
        vi.spyOn(process, 'on').mockImplementation((event, listener) => {
            handlers.set(String(event), listener as (...args: unknown[]) => void);
            return process;
        });
        vi.spyOn(process, 'exit').mockImplementation((code) => {
            exitCodes.push(typeof code === 'number' ? code : 0);
            return undefined as never;
        });
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('registers a handler for every shutdown signal', () => {
        cleanupOnShutdown(() => undefined);
        expect([...handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM', 'uncaughtException']);
    });

    test('runs the cleanup and exits with 0 on SIGINT', () => {
        const cleanup = vi.fn();
        cleanupOnShutdown(cleanup);
        handlers.get('SIGINT')!();
        expect(cleanup).toHaveBeenCalledOnce();
        expect(exitCodes).toEqual([0]);
    });

    test('exits with 0 on SIGTERM', () => {
        cleanupOnShutdown(vi.fn());
        handlers.get('SIGTERM')!();
        expect(exitCodes).toEqual([0]);
    });

    test('exits with 1 on uncaughtException', () => {
        const cleanup = vi.fn();
        cleanupOnShutdown(cleanup);
        handlers.get('uncaughtException')!();
        expect(cleanup).toHaveBeenCalledOnce();
        expect(exitCodes).toEqual([1]);
    });

    test('runs the cleanup only once when several signals arrive', () => {
        const cleanup = vi.fn();
        cleanupOnShutdown(cleanup);
        handlers.get('SIGINT')!();
        handlers.get('SIGTERM')!();
        handlers.get('uncaughtException')!();
        expect(cleanup).toHaveBeenCalledOnce();
        expect(exitCodes).toEqual([0]);
    });

    test('exits with 1 when the cleanup itself throws', () => {
        cleanupOnShutdown(() => {
            throw new Error('cleanup failed');
        });
        handlers.get('SIGTERM')!();
        expect(exitCodes).toEqual([1]);
    });
});
