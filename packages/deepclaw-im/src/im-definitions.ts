export type IM = {
    connect: (appId: string, secret: string) => {
        disconnect: () => void;
    };
}
