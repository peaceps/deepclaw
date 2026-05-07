import path from 'path';
import dotenv from 'dotenv';

import { LLMTool } from '../definitions/tool-definitions.js';
import { LoopMessageParam } from '../definitions/definitions.js';

dotenv.config({ path: path.join(process.cwd(), '.env'), quiet: true });

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

export abstract class LLMModel<I, IM, O, T, LLM> {
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

    protected abstract convertMessages(messages: LoopMessageParam<I>[]): IM[];

    abstract invoke(messages: LoopMessageParam<I>[], onStreamEvent: (text: string) => void): Promise<O>;

}