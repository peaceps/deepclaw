import { describe, expect, test } from 'vitest';
import { TraceHandler } from './trace-handler';

const EVENT = {eventType: 'interaction', loopId: 'agent.a1', browserId: 'eval', type: 'input'} as const;

describe('the trace handler', () => {

    test('keeps the answer as the user would have seen it stream in', () => {
        const handler = new TraceHandler();

        handler.onStreamText({eventType: 'stream', loopId: 'agent.a1', browserId: 'eval', text: 'hello ', done: false});
        handler.onStreamText({eventType: 'stream', loopId: 'agent.a1', browserId: 'eval', text: 'there', done: true});

        expect(handler.streamedText).toBe('hello there');
    });

    test('answers a question the scenario prepared for, matched on a fragment', async () => {
        const handler = new TraceHandler({'may I run': 'yes'});

        const answer = await handler.onInteractionEvent({...EVENT, content: 'may I run this command?'});

        expect(answer).toBe('yes');
        expect(handler.unexpectedInteractions).toEqual([]);
    });

    test('records a question nobody prepared for and gets out of the way', async () => {
        const handler = new TraceHandler({'may I run': 'yes'});

        const answer = await handler.onInteractionEvent({...EVENT, content: 'what is your name?'});

        expect(answer).toBe('');
        expect(handler.unexpectedInteractions).toEqual(['what is your name?']);
    });

    test('collects the info events the agent announced', () => {
        const handler = new TraceHandler();

        handler.onInfoEvent({eventType: 'info', loopId: 'agent.a1', type: 'project', content: 'p1'} as any);

        expect(handler.infoEvents).toHaveLength(1);
    });
});
