import { AgentIdentity, FlushAgent, type AgentHandler, type FlushAgentConstructor } from '@deepclaw/core';
import { DeepclawConfig, loadAgentConfig, loadConfig} from '@deepclaw/config';
import { OpenAIChatLoop } from './loop/loop/openai-chat-loop';
import { OpenAIResponseLoop } from './loop/loop/openai-response-loop';
import { AnthropicLoop } from './loop/loop/anthropic-loop';
import './loop/hooks/hooks';
import { FileUtils } from '@deepclaw/utils';
import { AGENTS_DIR, AGENT_MD, AGENT_SOUL_JSON } from './paths';
import { ensureBaseFiles } from '../base-file-initializer';

export class LoopInitializer {
    private static agentMap: Map<string, AgentIdentity> = new Map();

    static {
        ensureBaseFiles();
        for (const agent of loadConfig<DeepclawConfig['agents']>('agents')) {
            this.ensureAgentFiles(agent.id);
            this.agentMap.set(agent.id, this.loadIdentity(agent.id));
        }
    }

    public static getAgents(): AgentIdentity[] {
        return [...this.agentMap.values()];
    }

    public static getLoop(agentId: string, handler: AgentHandler): FlushAgent {
        this.ensureAgentFiles(agentId);
        const identity = this.loadIdentity(agentId);
        let loopClass: FlushAgentConstructor = this.getLoopClass(agentId);
        return new loopClass(identity, handler);
    }

    private static getLoopClass(agentId: string): FlushAgentConstructor {
        const llmConfig = loadAgentConfig(agentId).llm;
        if (llmConfig.provider === 'openai') {
            return llmConfig.responseApi ? OpenAIResponseLoop : OpenAIChatLoop;
        } else if (llmConfig.provider === 'anthropic') {
            return AnthropicLoop;
        } else {
            throw new Error('Invalid LLM model');
        }
    }

    private static ensureAgentFiles(agentId: string) {
        FileUtils.ensureFileExist(`${AGENTS_DIR}/${agentId}/${AGENT_MD}`);
        FileUtils.ensureFileExist(`${AGENTS_DIR}/${agentId}/${AGENT_SOUL_JSON}`, '{}');
    }

    private static loadIdentity(agentId: string): AgentIdentity {
        const identity = {} as AgentIdentity;
        try {
            identity.name = loadAgentConfig(agentId).name;
            const soulContent = FileUtils.readFile(`${AGENTS_DIR}/${agentId}/${AGENT_SOUL_JSON}`);
            const soul = JSON.parse(soulContent);
            Object.assign(identity, soul);
            identity.description = FileUtils.readFile(`${AGENTS_DIR}/${agentId}/${AGENT_MD}`);
        } catch (err) {
            throw new Error(
            `Failed to load identity for agent "${agentId}": ${(err as Error).message}`,
            { cause: err }
            );
        }
        return identity;
    }
}
