import { FlushAgent, type AgentHandler, type FlushAgentConstructor } from '@deepclaw/core';
import { loadAgentConfig } from '@deepclaw/config';
import { OpenAIChatLoop } from './loop/loop/openai-chat-loop';
import { OpenAIResponseLoop } from './loop/loop/openai-response-loop';
import { AnthropicLoop } from './loop/loop/anthropic-loop';
import './loop/hooks/hooks';
import { FileUtils } from '@deepclaw/utils';
import { AGENTS_DIR, AGENT_MD, AGENT_SOUL_JSON } from './paths';

export class LoopInitializer {

    public static getLoop(name: string, handler: AgentHandler): FlushAgent {
        this.ensureAgentFiles(name);
        let loopClass: FlushAgentConstructor = this.getLoopClass(name);
        return new loopClass(name, handler);
    }

    private static getLoopClass(name: string): FlushAgentConstructor {
        const llmConfig = loadAgentConfig(name).llm;
        if (llmConfig.provider === 'openai') {
            return llmConfig.responseApi ? OpenAIResponseLoop : OpenAIChatLoop;
        } else if (llmConfig.provider === 'anthropic') {
            return AnthropicLoop;
        } else {
            throw new Error('Invalid LLM model');
        }
    }

    private static ensureAgentFiles(name: string) {
        FileUtils.ensureFileExist(`${AGENTS_DIR}/${name}/${AGENT_MD}`);
        FileUtils.ensureFileExist(`${AGENTS_DIR}/${name}/${AGENT_SOUL_JSON}`, '{}');
    }
}
