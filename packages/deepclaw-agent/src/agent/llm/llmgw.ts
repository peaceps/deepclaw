import {DeepclawConfig} from '@deepclaw/config';
import {type Logger} from '@deepclaw/utils';
import { LLMTool } from '../definitions/tool-definitions';
import { TransitionReason } from '../definitions/definitions';

const llmRetry = 3;

export type LLMConstructor<I, O, T, LLM> = new (llmConfig: DeepclawConfig['agents'][0]['llm'], tools: LLMTool[]) => LLMModel<I, O, T, LLM>;

export abstract class LLMModel<I, O, T, LLM> {
    protected client: LLM;
    protected tools?: T[];
    protected gw;

    constructor(llmConfig: DeepclawConfig['agents'][0]['llm'], tools: LLMTool[] = []) {
        this.gw = {
            baseUrl: llmConfig.baseUrl,
            apiKey: llmConfig.apiKey,
            model: llmConfig.model,
            headers: !llmConfig.workspace ? undefined : {
                'api-key': llmConfig.apiKey,
                'workspacename': llmConfig.workspace,
            },
            timeoutMs: 300 * 1000, // JSON: seconds → client: ms
            temperature: 0.1,
            maxTokens: 8000
        }
        this.tools = this.convertTools(tools);
        this.client = this.createLLMClient();
    }
    
    protected abstract convertTools(tools: LLMTool[]): T[];

    protected abstract createLLMClient(): LLM;

    public async invoke(system: string, messages: I[], streamer: (text: string) => void, logger: Logger): Promise<O> {
        let response: O | null = null;
        for (let i = 0; i < llmRetry; i++) {
            try {
                response = await this._invoke(system, messages, streamer);
                break;
            } catch (error) {
                logger.error(error, 'LLM invoke failed');
                if (this.isInputExceedLimit(error)) {
                    response = this.newResponse('Input token exceeds the limit.', 'inputMaxTokens');
                } else {
                    const unrecoverableError = this.isUnrecoverableError(error);
                    if (unrecoverableError) {
                        response = this.newResponse(`ERROR: Unrecoverable error: ${unrecoverableError}.`, 'error');
                        break;
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        if (!response) {
            response = this.newResponse(`ERROR: LLM invoke failed after ${llmRetry} retries.`, 'error');
        }
        messages.push(...this.convertResponseToMessages(response));
        return response;
    }

    protected abstract _invoke(system: string, messages: I[], streamer: (text: string) => void): Promise<O>;

    protected abstract isInputExceedLimit(error: any): boolean;

    private isUnrecoverableError(error: any): string {
        const code = error?.status;
        if (code === 400 || code === 429 || code === 403 || code === 401 || code === 404) {
            return error?.message ?? code.toString();
        }
        return '';
    }

    public async compact(system: string, content: string, logger: Logger): Promise<string> {
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
        const response = await this.invoke(system, [this.newInputMessage(prompt)], () => {}, logger);
        return this.getTextFromResponse(response);
    }
    
    public newInputMessage(content: string): I {
        return {role: 'user', content} as I;
    }

    protected abstract setTransitionReason(response: O): O;

    protected abstract newResponse(content: string, transitionReason?: TransitionReason): O;

    protected abstract convertResponseToMessages(response: O): I[];

    protected abstract getTextFromResponse(response: O): string;

    public abstract getTextFromInputMessage(message: I): string;

}
