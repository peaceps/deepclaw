export type CommonKeys<T, U> = {
    [K in keyof T & keyof U]: T[K] & U[K]
};

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type UpdateContent<T> = Partial<T> & {id: string};
