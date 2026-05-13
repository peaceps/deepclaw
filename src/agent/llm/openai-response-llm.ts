import { OpenAI } from "openai";
import { randomUUID } from "node:crypto";
import { LLMModel } from './llmgw.js';
import { LLMTool } from '../definitions/tool-definitions.js';
import {
    ResponseInputItem,
    Tool,
    Response,
    EasyInputMessage,
    ResponseFunctionToolCall,
    ResponseOutputMessage,
} from "openai/resources/responses/responses.js";

export type ThinkingMessage = EasyInputMessage | ResponseFunctionToolCall | ResponseInputItem.FunctionCallOutput;

type ThinkingResponseOutput = ResponseOutputMessage | ResponseFunctionToolCall;

export type ThinkingResponse = Omit<Response, 'output'> & {
    output: ThinkingResponseOutput[];
};

export class OpenAIResponseLLM extends LLMModel<ThinkingMessage, ThinkingResponse, Tool, OpenAI> {

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
    
    protected override async _invoke(
        messages: ThinkingMessage[],
        onStreamEvent: (text: string) => void
    ): Promise<ThinkingResponse> {

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
                    return event.response as ThinkingResponse;
                case 'response.failed':
                    console.error('LLM response failed:', event);
                    return this.newResponse(event.response.error?.message || 'Unknown error');
                case 'error':
                    onStreamEvent(`发生错误 ${event.code} on ${event.param}: ${event.message}`);
                    return this.newResponse(event.message);
            }
        }

        return this.newResponse('No response received.');
    }

    protected override newResponse(message: string): ThinkingResponse {
        return {
            id: randomUUID(),
            object: 'response',
            created_at: Date.now(),
            output: [{
                id: randomUUID(),
                status: 'completed' as const,
                type: 'message' as const,
                role: 'assistant' as const,
                content: [{type: 'output_text' as const, text: message, annotations: []}]
            }],
            output_text: '',
            error: null,
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

    protected override convertResponseToMessages(response: ThinkingResponse): ThinkingMessage {
        const functionCall = response.output.find(out => out.type === 'function_call' as const);
        if (functionCall) {
            return {
                type: 'function_call',
                call_id: functionCall.call_id,
                arguments: functionCall.arguments,
                name: functionCall.name,
                id: functionCall.id
            }
        } else {
            const text = response.output.filter(out => out.type === 'message')
                .flatMap(message => message.content.filter(c => c.type === 'output_text').map(c => c.text)).join('\n');
            return {
                role: 'assistant',
                content: (!text ? response.output_text : text) || ''
            }
        }
    }
    
    protected override getTextFromResponse(response: ThinkingResponse): string {
        return response.output.filter(out => out.type === 'message')
            .flatMap(message => message.content.filter(c => c.type === 'output_text').map(c => c.text)).join('\n');
    }
}
