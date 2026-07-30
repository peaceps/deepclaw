import {describe, expect, test} from 'vitest';
import React, {useContext} from 'react';
import {Text} from 'ink';
import {render} from 'ink-testing-library';
import {STATIC_CONTEXT_DEFAULT, StaticContext} from './static-context';

/** The context can only be read from a render, so ink renders the value into a frame. */
function Probe(): React.ReactElement {
    const {indent, prompt} = useContext(StaticContext);
    return React.createElement(Text, null, `${indent}|${prompt}`);
}

function frameOf(element: React.ReactElement): string {
    return render(element).lastFrame() ?? '';
}

describe('STATIC_CONTEXT_DEFAULT', () => {

    test('indents by two columns and prompts with three angles', () => {
        expect(STATIC_CONTEXT_DEFAULT).toEqual({indent: 2, prompt: '>>>'});
    });
});

describe('StaticContext', () => {

    test('hands the default value to a consumer without a provider', () => {
        expect(frameOf(React.createElement(Probe))).toBe('2|>>>');
    });

    test('hands the value of the provider to a consumer below it', () => {
        const provided = React.createElement(
            StaticContext.Provider,
            {value: {indent: 4, prompt: '$'}},
            React.createElement(Probe),
        );
        expect(frameOf(provided)).toBe('4|$');
    });
});
