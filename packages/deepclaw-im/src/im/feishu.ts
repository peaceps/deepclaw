import { IM } from "../im-definitions";

export const feishu: IM = {
    connect: (appId: string, secret: string) => {
        console.log(appId, secret);
        return {
            disconnect: () => {}
        }
    }
}
