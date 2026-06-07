import { OpenAI } from "openai";
import { randomUUID } from "node:crypto";
import { i18nInstance } from '@deepclaw/i18n';
import { LLMModel } from './llmgw';
import { LLMTool } from '../definitions/tool-definitions';
import {
    ResponseInputItem,
    Tool,
    Response,
    EasyInputMessage,
    ResponseFunctionToolCall,
    ResponseOutputMessage,
} from "openai/resources/responses/responses.js";
import { TransitionReason } from "../definitions/definitions";

export type ThinkingMessage = EasyInputMessage | ResponseFunctionToolCall | ResponseInputItem.FunctionCallOutput;

type ThinkingResponseOutput = ResponseOutputMessage | ResponseFunctionToolCall;

export type ThinkingResponse = Omit<Response, 'output'> & {
    output: ThinkingResponseOutput[];
    transitionReason: TransitionReason;
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
        return new OpenAI({
            baseURL: this.gw.baseUrl,
            apiKey: this.gw.apiKey,
            timeout: this.gw.timeoutMs,
            defaultHeaders: this.gw.headers
        });
    }
    
    protected override async _invoke(
        system: string,
        messages: ThinkingMessage[],
        streamer: (text: string) => void
    ): Promise<ThinkingResponse> {

        const stream = await this.client.responses.create({
            model: this.gw.model,
            instructions: system,
            input: messages,
            stream: true,
            tools: this.tools,
            max_output_tokens: this.gw.maxTokens,
            temperature: this.gw.temperature,
        });

        for await (const event of stream) {
            switch (event.type) {
                case 'response.output_text.delta':
                    streamer(event.delta);
                    break;
                case 'response.completed':
                    return this.setTransitionReason(event.response);
                case 'response.failed':
                    return this.flushAndRespondError(streamer, i18nInstance.t('agent.llm.openai.response.output.failed', {message: event.response.error?.message || ''}));
                case 'error':
                    return this.flushAndRespondError(streamer, i18nInstance.t(
                        'agent.llm.openai.response.output.error',
                        {code: event.code, param: event.param, message: event.message}
                    ));
            }
        }

        return this.flushAndRespondError(streamer,
            i18nInstance.t('agent.llm.openai.response.output.empty'));
    }

    protected override setTransitionReason(response: Response): ThinkingResponse {
        const thinkingResponse = response as ThinkingResponse;
        if (thinkingResponse.status === 'completed') {
            thinkingResponse.transitionReason = thinkingResponse.output.some(item => item.type === 'function_call') ?
                'toolUse' : 'endLoop';
        } else if (thinkingResponse.status === 'incomplete') {
            switch (thinkingResponse.incomplete_details?.reason) {
                case 'max_output_tokens':
                    thinkingResponse.transitionReason = 'maxTokens';
                    break;
                case 'content_filter':
                    thinkingResponse.transitionReason = 'refused';
            }
        }
        if (!thinkingResponse.transitionReason) {
            thinkingResponse.transitionReason = 'error';
            throw new Error('Invalid response status: ' + thinkingResponse.status);
        }
        return thinkingResponse;
    }

    private flushAndRespondError(streamer: (text: string) => void, message: string): ThinkingResponse {
        streamer(message);
        return this.newResponse(message, 'error');
    }

    protected override newResponse(message: string, transitionReason: TransitionReason = 'endLoop'): ThinkingResponse {
        return {
            transitionReason,
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
            instructions: '',
            metadata: null,
            model: this.gw.model,
            tools: [],
            temperature: this.gw.temperature,
            parallel_tool_calls: false,
            tool_choice: 'none',
            top_p: 1,
        }
    }

    protected override isInputExceedLimit(error: any): boolean {
        return error.status === 400 && error.error.type === 'invalid_request_error' && error.error.code === 'context_length_exceeded';
    }

    protected override convertResponseToMessages(response: ThinkingResponse): ThinkingMessage[] {
        const functionCalls = response.output.filter(out => out.type === 'function_call' as const);
        if (functionCalls.length > 0) {
            return functionCalls.map((functionCall) => ({
                type: 'function_call',
                call_id: functionCall.call_id,
                arguments: functionCall.arguments,
                name: functionCall.name,
                id: functionCall.id
            }));
        }
        const text = response.output.filter(out => out.type === 'message')
            .flatMap(message => message.content.filter(c => c.type === 'output_text').map(c => c.text)).join('\n');
        return [{
            role: 'assistant',
            content: (!text ? response.output_text : text) || ''
        }];
    }
    
    protected override getTextFromResponse(response: ThinkingResponse): string {
        return response.output.filter(out => out.type === 'message')
            .map(message => this.extractTextFromContent(message.content, 'output_text')).join('\n');
    }

    public override getTextFromInputMessage(message: ThinkingMessage): string {
        return message.type === 'function_call' || message.type === 'function_call_output' ? ''
            : this.extractTextFromContent(message.content, 'input_text');
    }

    private extractTextFromContent(content: string | {type: string; text?: string}[], attr: string): string {
        return typeof content === 'string' ? content :
            content.filter(block => block.type === attr).filter(block => !!block.text).map(block => block.text).join('\n');
    }
}
