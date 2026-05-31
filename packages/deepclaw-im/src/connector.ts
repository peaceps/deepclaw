import { FlushAgentConstructor } from "@deepclaw/core";
import { loadConfig, DeepclawConfig } from "@deepclaw/config";
import { dingTalk } from "./im/dingtalk";
import { feishu } from "./im/feishu";
import type { IM } from "./im-definitions";

type ImConfig = NonNullable<DeepclawConfig["agent"]["im"]>;

const ims: Record<string, IM> = {
    dingtalk: dingTalk,
    feishu: feishu,
};

const getIM = (engine: ImConfig["engine"]): IM => {
    const im = ims[engine];
    if (!im) {
        throw new Error(`IM engine ${engine} not found`);
    }
    return im;
}

export function connectIM(agentClass: FlushAgentConstructor): { disconnect: () => void } {
    const engine = loadConfig<ImConfig["engine"]>("agent.im.engine");
    const appId = loadConfig<string>('agent.im.appId');
    const secret = loadConfig<string>('agent.im.secret');
    if (!engine || !appId || !secret) {
        return {disconnect: () => {}};
    }
    return getIM(engine).connect(appId, secret, agentClass);
}
