import { createServer, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import type { ScriptedTurn } from './scenario';

/** What the model was asked, so a grader can assert on the prompt, the tools and the images. */
export type StubRequest = {
    model: string;
    messages: {role: string, content: unknown, [key: string]: unknown}[];
    tools: {function?: {name?: string}}[];
    maxTokens?: number;
};

export type LLMStub = {
    /** Goes straight into the agent config as llm.baseURL. */
    url: string;
    requests: StubRequest[];
    /** True when the loop asked more often than the script answers for. */
    exhausted: boolean;
    close(): Promise<void>;
};

const EXHAUSTED_TEXT = '[eval stub: the script ran out of answers]';
const USAGE = {
    prompt_tokens: 100,
    completion_tokens: 20,
    total_tokens: 120,
    prompt_tokens_details: {cached_tokens: 40},
};

/**
 * An OpenAI compatible endpoint that answers from a script instead of from a model. It is
 * stubbed at the wire, not at the class, so the real loop, the real tool layer and the real
 * hooks all run; only the thinking is fake. It listens on a port the OS picks, which keeps
 * cases free to run side by side.
 */
export function startLLMStub(script: ScriptedTurn[]): Promise<LLMStub> {
    const requests: StubRequest[] = [];
    let asked = 0;
    let issuedToolCalls = 0;
    let exhausted = false;

    const server = createServer((request, response) => {
        if (request.method !== 'POST') {
            response.writeHead(404).end();
            return;
        }
        readBody(request).then(body => {
            requests.push(asRequest(body));
            const turn = script[asked++];
            if (!turn) {
                exhausted = true;
            }
            writeStream(response, turn || {text: EXHAUSTED_TEXT}, () => `call_${++issuedToolCalls}`);
        }).catch(() => response.writeHead(400).end());
    });

    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
            const {port} = server.address() as AddressInfo;
            resolve({
                url: `http://127.0.0.1:${port}/v1`,
                requests,
                get exhausted() {
                    return exhausted;
                },
                close: () => closeServer(server),
            });
        });
    });
}

function readBody(request: NodeJS.ReadableStream): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        request.on('data', chunk => chunks.push(Buffer.from(chunk as Buffer)));
        request.on('error', reject);
        request.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch (error) {
                reject(error);
            }
        });
    });
}

function asRequest(body: Record<string, any>): StubRequest {
    return {
        model: body['model'],
        messages: body['messages'] || [],
        tools: body['tools'] || [],
        maxTokens: body['max_tokens'],
    };
}

function writeStream(response: ServerResponse, turn: ScriptedTurn, nextId: () => string): void {
    response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });
    const send = (payload: object) => response.write(`data: ${JSON.stringify(payload)}\n\n`);

    send(chunk({role: 'assistant', content: ''}));
    // The text arrives word by word, the same way a model dribbles it out, so the
    // streaming path of the loop is exercised rather than bypassed.
    for (const word of splitForStream(turn.text || '')) {
        send(chunk({content: word}));
    }
    // Ids stay unique for the whole run, the way a real provider issues them: a history that
    // reuses them cannot be read back turn by turn.
    (turn.toolCalls || []).forEach((toolCall, index) => {
        send(chunk({
            tool_calls: [{
                index,
                id: nextId(),
                type: 'function',
                function: {name: toolCall.name, arguments: JSON.stringify(toolCall.input ?? {})},
            }],
        }));
    });
    send(chunk({}, turn.toolCalls?.length ? 'tool_calls' : 'stop'));
    send({id: 'eval-stub', object: 'chat.completion.chunk', created: 0, model: 'eval-stub', choices: [], usage: USAGE});
    response.write('data: [DONE]\n\n');
    response.end();
}

function chunk(delta: object, finishReason: string | null = null): object {
    return {
        id: 'eval-stub',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'eval-stub',
        choices: [{index: 0, delta, finish_reason: finishReason}],
    };
}

function splitForStream(text: string): string[] {
    return text ? text.split(/(?<=\s)/) : [];
}

function closeServer(server: Server): Promise<void> {
    return new Promise(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
    });
}
