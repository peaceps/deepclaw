import path from 'path';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';

import { MessageParam } from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import { ParsedMessage } from '@anthropic-ai/sdk/lib/parser.js';
import { ToolUnion } from '@anthropic-ai/sdk/resources.js';
import { normalizeMessages, formatLLMText } from '../utils/utils.js';

dotenv.config({ path: path.join(process.cwd(), '.env'), quiet: true });

const gw = {
    embeddingModel: process.env['EMBENDING_MODEL_ID'] || 'text-embedding-3-small',
    model: process.env['MODEL_ID'] || 'GPT5',
    baseURL: process.env['ANTHROPIC_BASE_URL'] || '',
    apiKey: process.env['ANTHROPIC_API_KEY'] || '',
    headers: {
        'api-key': process.env['ANTHROPIC_API_KEY'] || '',
        'workspacename': process.env['ANTHROPIC_WORKSPACE_NAME'] || '',
    },
    timeoutMs: 300 * 1000, // JSON: seconds → client: ms
    temperature: 0.1,
    maxTokens: 8000,
    tavilyApiKey: process.env['TAVILY_API_KEY'] || '',
}

export class LLMModel {
    private client: Anthropic;
    private system: string;
    private tools?: ToolUnion[];

    constructor(system: string = '', tools?: ToolUnion[]) {
        this.system = system;
        this.tools = tools;
        this.client = new Anthropic({
            apiKey: gw.apiKey, // This is the default and can be omitted
            baseURL: gw.baseURL, // This is the default and can be omitted,
            timeout: gw.timeoutMs
        });
    }

    async invoke_sync(messages: MessageParam[]): Promise<any> {
        return this.client.messages.create({
            model: gw.model,
            system: this.system,
            messages,
            tools: this.tools,
            max_tokens: gw.maxTokens,
            temperature: gw.temperature,
            stream: false,
        });
    }

    async invoke(messages: MessageParam[], onStreamEvent: (text: string) => void): Promise<ParsedMessage<any>> {
        const stream = this.client.messages.stream({
            model: gw.model,
            system: this.system,
            messages: normalizeMessages(messages),
            tools: this.tools,
            max_tokens: gw.maxTokens,
            temperature: gw.temperature
        }).on('text', (text) => {
            onStreamEvent(formatLLMText(text));
        });

        const message = await stream.finalMessage();
        return message;
    }
}