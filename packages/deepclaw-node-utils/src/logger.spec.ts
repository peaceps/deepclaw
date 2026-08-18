import {describe, expect, test, vi} from 'vitest';
import {FileUtils} from './file-utils';
import {getLogger, getLoopLogger} from './logger';

const mocks = vi.hoisted(() => {
    const child = vi.fn((bindings: Record<string, unknown>) => ({bindings}));
    const root = vi.fn<(config: unknown) => {child: typeof child}>(() => ({child}));
    return {child, root};
});

vi.mock('pino', () => {
    const pino = mocks.root as unknown as {stdTimeFunctions: {isoTime: () => string}};
    pino.stdTimeFunctions = {isoTime: () => '2026-01-01T00:00:00.000Z'};
    return {default: pino};
});

describe('getLogger', () => {

    test('binds the given name on a child logger', () => {
        getLogger('mcp-service');
        expect(mocks.child).toHaveBeenCalledWith({name: 'mcp-service'});
    });
});

describe('getLoopLogger', () => {

    test('binds the loop id and the run id on a child logger', () => {
        getLoopLogger('agent.a1', 'sub1');
        expect(mocks.child).toHaveBeenCalledWith({loopId: 'agent.a1', runId: 'sub1'});
    });

    test('leaves the run id undefined when it is not given', () => {
        getLoopLogger('agent.a1');
        expect(mocks.child).toHaveBeenCalledWith({loopId: 'agent.a1', runId: undefined});
    });
});

describe('root logger', () => {

    test('is created once and shared by every child', () => {
        getLogger('one');
        getLogger('two');
        getLoopLogger('agent.a1');
        expect(mocks.root).toHaveBeenCalledOnce();
    });

    /** The web server of a published build runs from its own installation, never from the home. */
    test('writes to a file under the .logs of the working dir and creates the folder when missing', () => {
        getLogger('any');
        const config = mocks.root.mock.calls[0]![0] as {
            transport: {target: string, options: {destination: string, mkdir: boolean}}
        };
        expect(config.transport.target).toBe('pino/file');
        expect(config.transport.options.mkdir).toBe(true);
        expect(config.transport.options.destination).toMatch(/\/\.logs\/runtime_\d+\.log$/);
        expect(config.transport.options.destination.startsWith(FileUtils.getWorkingDir())).toBe(true);
    });
});
