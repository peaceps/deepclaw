import { SSEServer } from "@/app/api/sse-server";
import { AgentsConfig, loadConfig } from "@deepclaw/config";
import { connectIM } from "@deepclaw/im";
import { cleanupOnShutdown, getLogger } from "@deepclaw/node-utils";
import { globalize } from "@deepclaw/utils";

const logger = getLogger('IMService');

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
                this.connect(agent.id, agent.name);
            } else {
                this.disconnect(agent.id);
            }
        });
    }

    public static async connect(agentId: string, agentName: string) {
        const token = () => {};
        this.runningIM[agentId] = token;
        try {
            const {disconnect} = await connectIM(agentId);
            if (this.runningIM[agentId] === token) {
                this.runningIM[agentId] = disconnect;
                SSEServer.sendToast({key: 'imConnected', data: agentName});
            } else {
                disconnect();
            }
        } catch (e) {
            logger.error(`connect im for agent ${agentId} failed: ${e}`);
            if (this.runningIM[agentId] === token) {
                delete this.runningIM[agentId];
            }
            SSEServer.sendToast({key: 'imConnectFailed', data: agentName});
        }
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
