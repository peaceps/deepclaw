import { AgentIdentity, FlushAgent, type AgentHandler, type FlushAgentConstructor } from '@deepclaw/core';
import { DeepclawConfig, loadAgentConfig, loadConfig} from '@deepclaw/config';
import { i18nInstance, parseArrayI18n } from '@deepclaw/i18n';
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
    }

    public static getAgents(): AgentIdentity[] {
        if (this.agentMap.size === 0) {
            for (const agent of loadConfig<DeepclawConfig['agents']>('agents')) {
                this.ensureAgentFiles(agent.id);
                this.agentMap.set(agent.id, this.loadIdentity(agent.id));
            }
        }
        return [...this.agentMap.values()];
    }

    public static getLoop(agentId: string, handler: AgentHandler): FlushAgent {
        const identity = this.agentMap.get(agentId);
        if (!identity) {
            throw new Error(`Agent "${agentId}" not found`);
        }
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
        FileUtils.ensureFileExist(
            `${AGENTS_DIR}/${agentId}/${AGENT_MD}`,
            i18nInstance.t('agent.identity.default.description')
        );
        FileUtils.ensureFileExist(`${AGENTS_DIR}/${agentId}/${AGENT_SOUL_JSON}`, 
            JSON.stringify({
                id: agentId,
                avatar: '🐋',
                role: i18nInstance.t('agent.identity.default.role'),
                personalities: parseArrayI18n('agent.identity.default.personalities'),
                emotion: true,
                skills: parseArrayI18n('agent.identity.default.skills')
            }, null, 2)
        );
    }

    private static loadIdentity(agentId: string): AgentIdentity {
        const agentConfig = loadAgentConfig(agentId);
        const identity: AgentIdentity = {
            id: '',
            name: '',
            fired: false,
            avatar: '',
            role: '',
            description: '',
            personalities: [],
            emotion: false,
            skills: []
        };
        try {
            const soulContent = FileUtils.readFile(`${AGENTS_DIR}/${agentId}/${AGENT_SOUL_JSON}`);
            const soul = JSON.parse(soulContent);
            Object.assign(identity, soul);
            identity.id = agentId;
            identity.name = agentConfig.name;
            identity.fired = !!agentConfig.fired;
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
