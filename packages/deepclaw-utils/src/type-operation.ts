export type CommonKeys<T, U> = {
    [K in keyof T & keyof U]: T[K] & U[K]
};

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type StringKeys<T> = { [P in keyof T]: T[P] extends string ? P : never }[keyof T];

export type UpdateContent<T, K extends StringKeys<T> = Extract<'id', StringKeys<T>>> = {
    [P in keyof T]?: T[P] | null;
} & { [P in K]-?: T[P] };
