import { OpenAI } from "openai";
import { randomUUID } from "node:crypto";
import { LLMModel } from './llmgw.js';
import { LLMTool } from '../definitions/tool-definitions.js';
import { ResponseInputItem, Tool, Response, ResponseError } from "openai/resources/responses/responses.js";

export class OpenAIResponseLLMModel extends LLMModel<ResponseInputItem, Response, Tool, OpenAI> {

    protected override convertTools(tools: LLMTool[]): Tool[] {
        return tools!.map(tool => ({
            type: 'function',
            name: tool.name,
            strict: true,
            parameters: tool.schema,
            description: tool.description
        }));
    }

    protected override createLLMClient(): OpenAI {
        return new OpenAI({timeout: this.gw.timeoutMs, defaultHeaders: this.gw.headers});
    }
    
    override async invoke(
        messages: ResponseInputItem[],
        onStreamEvent: (text: string) => void
    ): Promise<Response> {

        const stream = await this.client.responses.create({
            model: this.gw.model,
            instructions: this.system,
            input: messages,
            stream: true,
            tools: this.tools,
            max_output_tokens: this.gw.maxTokens,
            temperature: this.gw.temperature,
        });

        for await (const event of stream) {
            switch (event.type) {
                case 'response.output_text.delta':
                    onStreamEvent(event.delta);
                    break;
                case 'response.completed':
                    return event.response;
                case 'response.failed':
                    console.error('LLM response failed:', event);
                    return this.newResponse('');
                case 'error':
                    onStreamEvent(`发生错误 ${event.code} on ${event.param}: ${event.message}`);
                    return this.newResponse('', {
                        code: 'server_error',
                        message: `LLM模型发生错误: ${event.message}`,
                    });
            }
        }

        return this.newResponse('', {
            code: 'server_error',
            message: `LLM模型发生错误: No response received.`,
        });
    }

    private newResponse(outputText: string = '', error: ResponseError | null = null): Response {
        return {
            id: randomUUID(),
            object: 'response',
            created_at: Date.now(),
            output: [],
            output_text: outputText,
            error,
            incomplete_details: null,
            instructions: this.system,
            metadata: null,
            model: this.gw.model,
            tools: [],
            temperature: this.gw.temperature,
            parallel_tool_calls: false,
            tool_choice: 'none',
            top_p: 1,
        }
    }
}