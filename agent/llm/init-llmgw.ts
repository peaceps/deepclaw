import path from 'path';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';

import { MessageParam } from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import { ToolUnion } from '@anthropic-ai/sdk/resources.js';

dotenv.config({ path: path.join(process.cwd(), '../.env') });

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

    constructor(private system: string = '', private tools?: ToolUnion[]) {
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

    async invoke(messages: MessageParam[], onStreamEvent: (text: string) => void): Promise<string> {
        const stream = await this.client.messages.create({
            model: gw.model,
            system: this.system,
            messages,
            tools: this.tools,
            max_tokens: gw.maxTokens,
            temperature: gw.temperature,
            stream: true,
        });

        let res = '';

        for await (const event of stream) {
            // 每次数据更新时，通常只处理文本内容增量（delta）
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                // 实时输出文本，形成打字机效果
                onStreamEvent(event.delta.text);
                res += event.delta.text;
            }
            // 你也可以处理其他事件类型，例如 message_start, content_block_start 等[reference:3]
            // console.log("Event type:", event.type);
        }

        return res;
    }
}