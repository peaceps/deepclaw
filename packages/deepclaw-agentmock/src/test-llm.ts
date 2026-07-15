import { LLMModel, LLMTool } from "@deepclaw/agent";
import { LLMTransitionReason, TokenUsage } from "@deepclaw/core";

export type ThinkingMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool_result';
    content: any;
}

export type ThinkingResponse = {
    transitionReason: LLMTransitionReason;
    content: ThinkingMessage[];
    usage: {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
    }
}

export type Tool = {};

export class LLMClient {};

// TODO need implement
export class TestLLM extends LLMModel<ThinkingMessage, ThinkingResponse, Tool, LLMClient> {
    protected override isInputExceedLimit(error: any): boolean {
        return !error;
    }
    protected override setTransitionReason(response: ThinkingResponse): ThinkingResponse {
        return response;
    }
    protected override newResponse(content: string, transitionReason?: LLMTransitionReason): ThinkingResponse {
        return {
            transitionReason: transitionReason || 'endLoop',
            content: [{role: 'assistant', content}], usage: {input_tokens: 0, output_tokens: 0}
        };
    }
    protected override convertResponseToMessages(response: ThinkingResponse): ThinkingMessage[] {
        return response.content;
    }
    protected override getTextFromResponse(response: ThinkingResponse): string {
        return response.content.map(msg => msg.content).join(' ');
    }
    public override getTextFromInputMessage(message: ThinkingMessage): string {
        return message.content;
    }

    protected override convertTools(tools: LLMTool[]): Tool[] {
        return tools.map(tool => (
            { type: 'function', function: {name: tool.name, description: tool.description, parameters: tool.schema} }
        ));
    }

    protected override createLLMClient(): LLMClient {
        return new LLMClient();
    }

    protected override async _invoke(): Promise<ThinkingResponse> {
        return this.newResponse('');
    }

    public override getTokenUsage(): TokenUsage {
        return {
            cachedInputTokens: 0,
            noCachedInputTokens: 0,
            outputTokens: 0,
        };
    }
}
