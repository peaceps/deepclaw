import { AgentsConfig, loadConfig } from "@deepclaw/config";
import { connectIM } from "@deepclaw/im";
import { cleanupOnShutdown } from "@deepclaw/node-utils";
import { globalize } from "@deepclaw/utils";

class IMServiceImpl {
    private static runningIM: Record<string, () => void> = {};

    public static init() {
        this.reset();
        cleanupOnShutdown(() => {
            Object.values(this.runningIM).forEach(cb => cb());
        })
    }

    public static reset() {
        loadConfig<AgentsConfig>('agents').forEach((agent) => {
            if (agent.im?.enabled) {
                if (this.runningIM[agent.id]) {
                    return;
                }
                this.connect(agent.id);
            } else {
                this.disconnect(agent.id);
            }
        });
    }

    public static connect(agentId: string) {
        const {disconnect} = connectIM(agentId);
        this.runningIM[agentId] = disconnect;
    }

    public static disconnect(agentId: string): void {
        const im = this.runningIM[agentId];
        if (!im) {
            return;
        }
        im();
        delete this.runningIM[agentId];
    }
}

export const IMService = globalize('IMService', IMServiceImpl);
