import { AgentHandler } from '@deepclaw/core';
import { ToolUseDef, LoopAgent, LLMConstructor, LLMProtocol, OneLoopContext, ToolUseResult } from "@deepclaw/agent";
import { TestLLM, ThinkingMessage, ThinkingResponse } from './test-llm';


export class TestLlmAgent extends LoopAgent<ThinkingMessage, ThinkingResponse, TestLLM> {
    protected override getLLMProtocol(): LLMProtocol {
        return 'OpenAIChat';
    }
    protected override getLLMConstructor(): LLMConstructor<ThinkingMessage, ThinkingResponse, unknown, unknown> {
        return TestLLM;
    }
    protected override addTokenUsage(context: OneLoopContext, response: ThinkingResponse): void {
    }
    
    protected override extractToolUseFromResponse(result: ThinkingResponse): ToolUseDef[] {
        return [];
    }
    protected override convertToolResultMessages(toolResults: ToolUseResult[]): ThinkingMessage[] {
        return [{role: 'user', content: []}];
    }
    protected override newSubLoop(agentId: string, projectId: string, subLoopAgentHandler: AgentHandler, history: ThinkingMessage[], parentSessionId: string): LoopAgent<ThinkingMessage, ThinkingResponse, TestLLM> {
        return new TestLlmAgent(agentId, subLoopAgentHandler, projectId, history, parentSessionId);
    }

    protected override async _invoke(): Promise<string> {
        const text = [
            'The pattern continues',
            'up to number 100, with a',
            'similar long sentence',
            'added after every group',
            'of ten numbers. Due to',
            'the format\'s repetitive',
            'nature, only the start',
            'and one instance of the',
            'long sentence have been',
            'shown above.'
        ];
        const lines: string[] = [];
        for (let i = 0; i < 80; i++) {
            lines.push(`its ${i} The pattern 100`);
            if (i > 0 && i % 10 === 0) {
                for (const word of text) {
                    lines.push(word + ' ');
                }
                lines.push(`...`);
            }
        }
        let i = 0;
        return new Promise((resolve) => {
            const interval = setInterval(() => {
                this.agentHandler.onStreamText({text: lines[i++]!});
                if (i >= lines.length) {
                    clearInterval(interval);
                    resolve('its done.');
                }
            }, 100);
        });
    }
}
