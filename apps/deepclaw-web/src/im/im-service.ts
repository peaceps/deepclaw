import { AgentsConfig, loadConfig, validateCurrentAppConfig } from "@deepclaw/config";
import { getLoopId, newMessage } from "@deepclaw/core";
import { i18nInstance } from "@deepclaw/i18n";
import { connectIM, IMHooks } from "@deepclaw/im";
import { AgentLoopBusyEvent, LoopGateway } from "@deepclaw/loop-gateway";
import { globalize } from "@deepclaw/utils";

const WAIT_TIMEOUT = 5 * 60 * 1000;

class IMServiceImpl {
    private static runningIM: Record<string, () => void> = {};
    private static configInvalid: boolean = false;
    private static busyLoop: Record<string, {
        resolve: (value: unknown) => void,
        reject: (err: string) => void,
        timer?: ReturnType<typeof setTimeout>;
    }> = {};

    public static init() {
        LoopGateway.subscribe(e => {
            if (e.eventType === 'busy') {
                const loopId = (e as AgentLoopBusyEvent).loopId;
                const promise = this.busyLoop[loopId];
                if (promise) {
                    promise.resolve('');
                    clearTimeout(promise.timer);
                    delete this.busyLoop[loopId];
                }
            }
        });
        this.reset();
    }

    public static reset() {
        const {lacks} = validateCurrentAppConfig(true);
        this.configInvalid = lacks.length > 0;
        loadConfig<AgentsConfig>('agents').forEach((agent) => {
            if (agent.im) {
                if (this.runningIM[agent.id]) {
                    return;
                }
                const loopId = getLoopId('agent', agent.id);
                this.connect(agent.id, {
                    onReceive: () => this.configInvalid ? {stop: true, message: i18nInstance.t('web.im.invalidConfig')} : {stop: false},
                    waitReady: async () => {
                        if (LoopGateway.isLoopBusy(loopId)) {
                            const complete = new Promise((resolve, reject) => {
                                this.busyLoop[loopId] = {resolve, reject};
                            });
                            const timeout = new Promise(resolve => {
                                this.busyLoop[loopId].timer = setTimeout(resolve, WAIT_TIMEOUT);
                            }).then(() => {
                                if (this.busyLoop[loopId]) {
                                    this.busyLoop[loopId].reject('Timeout reached')
                                    delete this.busyLoop[loopId];
                                }
                            })
                            await Promise.race([complete, timeout]);
                        }
                    },
                    onInvoke: (input) => {
                        LoopGateway.fireBusyEvent(loopId, true);
                        LoopGateway.addMessage('', loopId, newMessage('user', agent.id, `📱 ${input}`));
                    },
                    postSend: (output) => {
                        LoopGateway.addMessage('', loopId, newMessage('agent', agent.id, `📱 ${output}`));
                        LoopGateway.fireBusyEvent(loopId, false);
                    }
                });
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
