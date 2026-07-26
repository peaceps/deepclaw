export type IMHooks = {
    onReceive?: () => {message?: string; stop: boolean};
    waitReady?: () => Promise<void>;
    onInvoke?: (input: string) => void;
    postSend?: (output: string) => void;
};

export type IM = {
    connect: (appId: string, secret: string, agentId: string, hooks?: IMHooks) => {
        disconnect: () => void;
    };
}
