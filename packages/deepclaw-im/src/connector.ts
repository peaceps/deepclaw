import { IMConfig, loadAgentConfig } from "@deepclaw/config";
import { dingTalk } from "./im/dingtalk";
import { feishu } from "./im/feishu";
import type { IM } from "./im-definitions";

const ims: Record<string, IM> = {
    dingtalk: dingTalk,
    feishu: feishu,
};

const getIM = (engine: NonNullable<IMConfig["engine"]>): IM => {
    const im = ims[engine];
    if (!im) {
        throw new Error(`IM engine ${engine} not found`);
    }
    return im;
}

export function connectIM(agentId: string): { disconnect: () => void } {
    const agent = loadAgentConfig(agentId);
    if (!agent) {
        return {disconnect: () => {}};
    }
    const engine = agent.im?.engine;
    const appId = agent.im?.appId;
    const secret = agent.im?.secret;
    if (!engine || !appId || !secret) {
        return {disconnect: () => {}};
    }
    return getIM(engine).connect(appId, secret, agent.id);
}
