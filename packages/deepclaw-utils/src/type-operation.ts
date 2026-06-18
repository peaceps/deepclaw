export type CommonKeys<T, U> = {
    [K in keyof T & keyof U]: T[K] & U[K]
};
