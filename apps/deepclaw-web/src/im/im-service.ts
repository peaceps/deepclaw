import { AgentsConfig, loadConfig, validateCurrentAppConfig } from "@deepclaw/config";
import { connectIM, IMHooks } from "@deepclaw/im";
import { globalize } from "@deepclaw/utils";

class IMServiceImpl {
    private static runningIM: Record<string, () => void> = {};
    private static configInvalid: boolean = false;

    public static reset() {
        const {lacks} = validateCurrentAppConfig(true);
        this.configInvalid = lacks.length > 0;
        loadConfig<AgentsConfig>('agents').forEach((agent) => {
            if (agent.im) {
                if (this.runningIM[agent.id]) {
                    return;
                }
                this.connect(agent.id, {preSend: () => {
                    const stop = this.configInvalid;
                    return {stop, message: stop ? 'You have config errors, please fix on web' : ''};
                }});
            } else {
                this.disconnect(agent.id);
            }
        });
    }

    public static connect(agentId: string, imHooks: IMHooks) {
        const {disconnect} = connectIM(agentId, imHooks);
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
