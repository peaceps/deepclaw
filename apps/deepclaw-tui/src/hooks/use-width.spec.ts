import {beforeEach, describe, expect, test, vi} from 'vitest';
import React from 'react';
import {Text} from 'ink';
import {render} from 'ink-testing-library';
import {useWidth} from './use-width';

const mocks = vi.hoisted(() => ({
    useStdout: vi.fn<() => {stdout: {columns: number | undefined}}>(),
}));

/** Only the terminal size is faked, the rest of ink still renders the frame. */
vi.mock('ink', async (importOriginal) => ({
    ...(await importOriginal<typeof import('ink')>()),
    useStdout: mocks.useStdout,
}));

function Probe({indent}: {indent?: number}): React.ReactElement {
    return React.createElement(Text, null, String(useWidth(indent)));
}

function widthOf(indent?: number): string {
    return render(React.createElement(Probe, {indent})).lastFrame() ?? '';
}

beforeEach(() => {
    mocks.useStdout.mockReturnValue({stdout: {columns: 100}});
});

describe('useWidth', () => {

    test('takes the whole terminal width without an indent', () => {
        expect(widthOf()).toBe('100');
    });

    test('subtracts the indent from the terminal width', () => {
        expect(widthOf(4)).toBe('96');
    });

    test('falls back to eighty columns when the terminal does not report a width', () => {
        mocks.useStdout.mockReturnValue({stdout: {columns: undefined}});
        expect(widthOf(10)).toBe('70');
    });

    test('never goes below eight columns', () => {
        mocks.useStdout.mockReturnValue({stdout: {columns: 20}});
        expect(widthOf(40)).toBe('8');
    });

    test('gives eight columns to an indent that eats the whole terminal', () => {
        mocks.useStdout.mockReturnValue({stdout: {columns: 8}});
        expect(widthOf(8)).toBe('8');
    });

    test('grows the width for a negative indent', () => {
        expect(widthOf(-10)).toBe('110');
    });
});
