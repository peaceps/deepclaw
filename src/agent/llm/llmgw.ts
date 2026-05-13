import path from 'path';
import dotenv from 'dotenv';

import { LLMTool } from '../definitions/tool-definitions.js';
import { loadAgentConfig } from '../../utils/config-utils.js';

dotenv.config({ path: path.join(process.cwd(), '.env'), quiet: true });
const llmRetry = loadAgentConfig<number>('llmRetry');

const gw = {
    model: process.env['MODEL_ID'] as string,
    headers: !process.env['WORKSPACE_NAME'] ? undefined : {
        'api-key': process.env['OPENAI_API_KEY'],
        'workspacename': process.env['WORKSPACE_NAME'],
    },
    timeoutMs: 300 * 1000, // JSON: seconds → client: ms
    temperature: 0.1,
    maxTokens: 8000
}

export abstract class LLMModel<I, O, T, LLM> {
    protected client: LLM;
    protected system: string;
    protected tools?: T[];
    protected gw = gw;

    constructor(system: string, tools: LLMTool[] = []) {
        this.system = system;
        this.tools = this.convertTools(tools);
        this.client = this.createLLMClient();
    }
    
    protected abstract convertTools(tools: LLMTool[]): T[];

    protected abstract createLLMClient(): LLM;

    public async invoke(messages: I[], onStreamEvent: (text: string) => void): Promise<O> {
        let response: O;
        for (let i = 0; i < llmRetry; i++) {
            try {
                response = await this._invoke(messages, onStreamEvent);
                break;
            } catch (error) {
                // TODO write logs to file
            }
        }
        response = this.newResponse(`ERROR: LLM invoke failed after ${llmRetry} retries.`);
        messages.push(this.convertResponseToMessages(response));
        return response;
    }

    protected abstract _invoke(messages: I[], onStreamEvent: (text: string) => void): Promise<O>;

    async compact(content: string): Promise<I> {
        const prompt =
`Summarize this agent conversation so work can continue.
Preserve:
1. The current goal
2. Important findings and decisions
3. Files read or changed
4. Remaining work
5. User constraints and preferences
6. The step to take next, which is the most important thing

Be compact but concrete.

${content}`;
        const response = await this.invoke([this.newInputMessage(prompt)], () => {});
        const text = this.getTextFromResponse(response);
        return this.newInputMessage(`This conversation was compacted so the agent can continue working.

            ${text}`);
    }
    
    public newInputMessage(content: string): I {
        return {role: 'user', content} as I;
    }

    protected abstract newResponse(content: string): O;

    protected abstract convertResponseToMessages(response: O): I;

    protected abstract getTextFromResponse(response: O): string;

}
