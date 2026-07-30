import {describe, expect, test, vi} from 'vitest';
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

    test('binds both loop ids on a child logger', () => {
        getLoopLogger('agent.a1', 'sub1');
        expect(mocks.child).toHaveBeenCalledWith({loopId: 'agent.a1', subLoopId: 'sub1'});
    });

    test('leaves the sub loop id undefined when it is not given', () => {
        getLoopLogger('agent.a1');
        expect(mocks.child).toHaveBeenCalledWith({loopId: 'agent.a1', subLoopId: undefined});
    });
});

describe('root logger', () => {

    test('is created once and shared by every child', () => {
        getLogger('one');
        getLogger('two');
        getLoopLogger('agent.a1');
        expect(mocks.root).toHaveBeenCalledOnce();
    });

    test('writes to a file under .logs and creates the folder when missing', () => {
        getLogger('any');
        expect(mocks.root).toHaveBeenCalledWith(expect.objectContaining({
            transport: {
                target: 'pino/file',
                options: expect.objectContaining({
                    destination: expect.stringMatching(/^\.\/\.logs\/runtime_\d+\.log$/),
                    mkdir: true,
                }),
            },
        }));
    });
});
