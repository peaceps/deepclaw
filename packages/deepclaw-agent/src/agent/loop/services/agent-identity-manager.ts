import { AgentSoulIdentity, AgentIdentity } from '@deepclaw/core';
import { DeepclawConfig, loadAgentConfig, loadConfig} from '@deepclaw/config';
import { i18nInstance, parseArrayI18n } from '@deepclaw/i18n';
import { FileUtils } from '@deepclaw/node-utils';
import { AGENTS_DIR, AGENT_MD, AGENT_SOUL_JSON } from '../../paths';

export class AgentIdentityManager {

    private static agentMap: Map<string, AgentIdentity> = new Map();

    public static getAgents(): AgentIdentity[] {
        if (this.agentMap.size === 0) {
            this.init();
        }
        return [...this.agentMap.values()];
    }

    public static getAgent(agentId: string): AgentIdentity | undefined {
        if (this.agentMap.size === 0) {
            this.init();
        }
        return this.agentMap.get(agentId);
    }

    private static init() {
        for (const agent of loadConfig<DeepclawConfig['agents']>('agents')) {
            this.ensureAgentFiles(agent.id);
            this.agentMap.set(agent.id, this.loadIdentity(agent.id));
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
                avatar: '🐟',
                role: i18nInstance.t('agent.identity.default.role'),
                personalities: parseArrayI18n('agent.identity.default.personalities'),
                emotion: true,
                expertises: parseArrayI18n('agent.identity.default.expertises')
            } as AgentSoulIdentity, null, 2)
        );
    }

    private static loadIdentity(agentId: string): AgentIdentity {
        const agentConfig = loadAgentConfig(agentId);
        try {
            const soulContent = FileUtils.readFile(`${AGENTS_DIR}/${agentId}/${AGENT_SOUL_JSON}`);
            const soul = JSON.parse(soulContent) as AgentSoulIdentity;
            return {
                ...soul,
                name: agentConfig.name,
                fired: !!agentConfig.fired,
                description: FileUtils.readFile(`${AGENTS_DIR}/${agentId}/${AGENT_MD}`)
            }
        } catch (err) {
            throw new Error(
            `Failed to load identity for agent "${agentId}": ${(err as Error).message}`,
            { cause: err }
            );
        }
    }

    public static newAgentIdentity(agentId: string): AgentIdentity {
        this.ensureAgentFiles(agentId);
        const identity = this.loadIdentity(agentId);
        this.agentMap.set(agentId, identity);
        return identity;
    }

    public static updateAgentIdentity(id: string, identity: Partial<AgentIdentity>): void {
        const current = this.agentMap.get(id);
        if (!current) {
            throw new Error(`Agent "${id}" not found`);
        }
        Object.assign(current, identity);
        this.agentMap.set(id, current);
        if ('avatar' in identity || 'role' in identity || 'personalities' in identity
            || 'emotion' in identity || 'expertises' in identity) {
            const soul: AgentSoulIdentity = {
                id: current.id,
                avatar: current.avatar,
                role: current.role,
                personalities: current.personalities,
                emotion: current.emotion,
                expertises: current.expertises,
            };
            FileUtils.writeFile(`${AGENTS_DIR}/${id}/${AGENT_SOUL_JSON}`, JSON.stringify(soul, null, 2));
        }
    }

    public static updateAgentDescription(id: string, description: string): void {
        const current = this.agentMap.get(id);
        if (!current) {
            throw new Error(`Agent "${id}" not found`);
        }
        current.description = description;
        this.agentMap.set(id, current);
        FileUtils.writeFile(`${AGENTS_DIR}/${id}/${AGENT_MD}`, description);
    }
}
