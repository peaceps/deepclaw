import {describe, expect, test} from 'vitest';
import {FlushAgent} from './flush-agent';
import {
    type AgentHandler, type AgentInvokeOptions, type AgentInvokeResponse,
    type AgentRuntime, type SealedAgentHandler
} from './flush-agent-types';
import {type AgentInfoEvent, type AgentInteractionEvent, type AgentStreamEvent} from './flush-agent-event';
import {type ImageContent} from './agent-definitions';

class TestAgent extends FlushAgent {
    public reply = 'done';
    /** Everything the run said, where it said more than it answered with. */
    public narration: string | undefined;
    public failWith = '';
    public lastInput = '';
    public lastImages: ImageContent[] | undefined;

    protected async _invoke(input: string, options: AgentInvokeOptions): Promise<AgentInvokeResponse> {
        this.lastInput = input;
        this.lastImages = options.images;
        if (this.failWith) {
            throw new Error(this.failWith);
        }
        return {
            text: this.reply,
            said: this.narration ?? this.reply,
            runtime: {...this.emptyRuntime(), turnCount: 3},
        };
    }

    public sealedHandler(): SealedAgentHandler {
        return this.agentHandler;
    }

    public newEmptyRuntime(): AgentRuntime {
        return this.emptyRuntime();
    }
}

function newRecordingHandler() {
    const streams: AgentStreamEvent[] = [];
    const interactions: AgentInteractionEvent[] = [];
    const infos: AgentInfoEvent[] = [];
    const handler: AgentHandler = {
        onStreamText: (e) => {
            streams.push(e);
        },
        onInteractionEvent: async (e) => {
            interactions.push(e);
            return 'answer';
        },
        onInfoEvent: (e) => {
            infos.push(e);
        },
    };
    return {handler, streams, interactions, infos};
}

describe('FlushAgent sealed handler', () => {

    test('stamps eventType and loopId on stream events and marks them unfinished', () => {
        const {handler, streams} = newRecordingHandler();
        const agent = new TestAgent('agent', 'a1', '', handler);
        agent.sealedHandler().onStreamText({browserId: 'b1', text: 'hello'});
        expect(streams).toEqual([{
            eventType: 'stream', loopId: 'agent.a1', browserId: 'b1', text: 'hello', done: false
        }]);
    });

    test('uses the project scoped loopId when a projectId is given', () => {
        const {handler, streams} = newRecordingHandler();
        const agent = new TestAgent('project', 'a1', 'p1', handler);
        agent.sealedHandler().onStreamText({browserId: 'b1', text: 'hello'});
        expect(streams[0]!.loopId).toBe('project.a1.p1');
    });

    test('normalizes CRLF in streamed text', () => {
        const {handler, streams} = newRecordingHandler();
        const agent = new TestAgent('agent', 'a1', '', handler);
        agent.sealedHandler().onStreamText({browserId: 'b1', text: 'first\r\nsecond'});
        expect(streams[0]!.text).toBe('first\nsecond');
    });

    test('keeps trailing whitespace while the stream is unfinished', () => {
        const {handler, streams} = newRecordingHandler();
        const agent = new TestAgent('agent', 'a1', '', handler);
        agent.sealedHandler().onStreamText({browserId: 'b1', text: 'partial  '});
        expect(streams[0]!.text).toBe('partial  ');
    });

    test('forwards the tag', () => {
        const {handler, streams} = newRecordingHandler();
        const agent = new TestAgent('agent', 'a1', '', handler);
        agent.sealedHandler().onStreamText({browserId: 'b1', text: 'x', tag: 'thinking'});
        expect(streams[0]!.tag).toBe('thinking');
    });

    test('stamps eventType and loopId on interaction events and returns the answer', async () => {
        const {handler, interactions} = newRecordingHandler();
        const agent = new TestAgent('project', 'a1', 'p1', handler);
        const answer = await agent.sealedHandler().onInteractionEvent({
            browserId: 'b1', type: 'input', content: 'name?'
        });
        expect(answer).toBe('answer');
        expect(interactions).toEqual([{
            eventType: 'interaction', loopId: 'project.a1.p1',
            browserId: 'b1', type: 'input', content: 'name?'
        }]);
    });

    test('passes info events straight through', () => {
        const {handler, infos} = newRecordingHandler();
        const agent = new TestAgent('agent', 'a1', '', handler);
        agent.sealedHandler().onInfoEvent({eventType: 'updateCron', content: {id: 'c1'}});
        expect(infos).toEqual([{eventType: 'updateCron', content: {id: 'c1'}}]);
    });
});

describe('FlushAgent invoke', () => {

    test('resolves with the text and runtime produced by the agent', async () => {
        const {handler} = newRecordingHandler();
        const agent = new TestAgent('agent', 'a1', '', handler);
        agent.reply = 'all good';
        const response = await agent.invoke('do it', {browserId: 'b1'});
        expect(agent.lastInput).toBe('do it');
        expect(response.text).toBe('all good');
        expect(response.runtime.turnCount).toBe(3);
    });

    test('hands the images of the caller to the agent', async () => {
        const {handler} = newRecordingHandler();
        const agent = new TestAgent('agent', 'a1', '', handler);
        const images: ImageContent[] = [{url: 'https://host/shot.png', mediaType: 'image/png'}];
        await agent.invoke('look', {browserId: 'b1', images});
        expect(agent.lastImages).toEqual(images);
    });

    test('flushes exactly one final stream event marked done', async () => {
        const {handler, streams} = newRecordingHandler();
        const agent = new TestAgent('agent', 'a1', '', handler);
        agent.reply = 'all good';
        await agent.invoke('do it', {browserId: 'b1'});
        expect(streams).toEqual([{
            eventType: 'stream', loopId: 'agent.a1', browserId: 'b1', text: 'all good', done: true
        }]);
    });

    /**
     * The event closes a stream that was read all along, so it carries the answer alone; the run
     * behind it is handed to the caller, who writes it down for whoever reads it later.
     */
    test('ends the stream with the answer and answers with the whole run', async () => {
        const {handler, streams} = newRecordingHandler();
        const agent = new TestAgent('agent', 'a1', '', handler);
        agent.reply = 'all good';
        agent.narration = 'looked around\n\nall good';
        const response = await agent.invoke('do it', {browserId: 'b1'});
        expect(streams[0]!.text).toBe('all good');
        expect(response.said).toBe('looked around\n\nall good');
    });

    test('trims trailing whitespace on the final event but not on the response', async () => {
        const {handler, streams} = newRecordingHandler();
        const agent = new TestAgent('agent', 'a1', '', handler);
        agent.reply = 'answer  \n\n';
        const response = await agent.invoke('x', {browserId: 'b1'});
        expect(streams[0]!.text).toBe('answer');
        expect(response.text).toBe('answer  \n\n');
    });

    test('turns a thrown error into the error message with an empty runtime', async () => {
        const {handler, streams} = newRecordingHandler();
        const agent = new TestAgent('agent', 'a1', '', handler);
        agent.failWith = 'llm exploded';
        const response = await agent.invoke('x', {browserId: 'b1'});
        expect(response.text).toBe('llm exploded');
        // Nothing was streamed on the way out, so the one line is the whole of the run as well.
        expect(response.said).toBe('llm exploded');
        expect(response.runtime).toEqual(agent.newEmptyRuntime());
        expect(streams[0]!.text).toBe('llm exploded');
    });
});

describe('FlushAgent emptyRuntime', () => {

    test('starts every counter at zero', () => {
        const {handler} = newRecordingHandler();
        const agent = new TestAgent('agent', 'a1', '', handler);
        expect(agent.newEmptyRuntime()).toEqual({
            turnCount: 0,
            historyPersistIndex: 0,
            recoveryState: {maxTokenRetries: 0, inputMaxTokenRetries: 0, refusalState: ''},
            usage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
        });
    });
});
