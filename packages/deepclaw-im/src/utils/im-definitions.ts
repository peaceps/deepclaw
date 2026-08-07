export type IM = {
    connect: (appId: string, secret: string, agentId: string) => Promise<{
        disconnect: () => void;
    }>;
}
