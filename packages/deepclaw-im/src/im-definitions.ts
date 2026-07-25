export type IMHooks = {
    preSend?: (event: any) => {message?: string; stop: boolean};
};

export type IM = {
    connect: (appId: string, secret: string, agentId: string, hooks?: IMHooks) => {
        disconnect: () => void;
    };
}
