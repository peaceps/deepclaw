import { FlushAgentConstructor } from "@deepclaw/core";
import { IM } from "../im-definitions";

export const feishu: IM = {
    connect: (appId: string, secret: string, agent: FlushAgentConstructor) => {
        console.log(appId, secret, agent);
        return {
            disconnect: () => {}
        }
    }
}
