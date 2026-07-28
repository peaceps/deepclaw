export type IM = {
    connect: (appId: string, secret: string, agentId: string) => {
        disconnect: () => void;
    };
}
