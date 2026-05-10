import { ResponseInputItem, Response, ResponseFunctionToolCall } from "openai/resources/responses/responses.js";
import { LoopAgent } from './loop'
import { ToolUseDef } from './services/tool-use-service';
import { ToolUseResult } from '../definitions/tool-definitions.js';
import { LoopState } from '../definitions/definitions';
import { OpenAIResponseLLMModel } from '../llm/openai-response-llm';

export class OpenAIResponseLoop extends LoopAgent<ResponseInputItem, Response, OpenAIResponseLLMModel> {

    protected override createLLMModel(): OpenAIResponseLLMModel {
        return new OpenAIResponseLLMModel(
            this.promptService.provideSystemPrompt(this.isSubLoop),
            this.toolUseService.getAvailableTools()
        );
    }

    protected override addStringMessage(message: string): void {
        this.history.push({role: 'user', content: message});
    }

    protected override convertResponseToMessages(response: Response): ResponseInputItem {
        const functionCall = response.output.find(out => out.type === 'function_call');
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

    protected override convertToolResultMessages(toolResults: ToolUseResult[]): ResponseInputItem[] {
        return toolResults.map(toolResult => ({
            role: 'tool',
            call_id: toolResult.id,
            output: toolResult.content,
            type: 'function_call_output',
            status: 'completed'
        }));
    }

    protected override quitLoop(result: Response): boolean {
        return result.status === 'completed' && !result.incomplete_details 
            && !result.output.some(item => item.type === 'function_call');
    }

    protected override extractToolCalls(result: Response): ToolUseDef[] {
        return result.output.filter(item => item.type === 'function_call').map(item => {
            return {
                name: item.name,
                input: JSON.parse(item.arguments),
                id: item.call_id,
            }
        });
    }
    
    protected override extractFinalText(state: LoopState<ResponseInputItem>): string {
        const message = state.messages[state.messages.length - 1]!;
        return (message as any).content as string;
    }

    override createSubLoop(fork: boolean = false): LoopAgent<ResponseInputItem, Response, OpenAIResponseLLMModel> {
        return new OpenAIResponseLoop(() => {}, fork ? this.history : [], true);
    }
}