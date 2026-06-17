export * from './file-utils';
export * from './logger';
export * from './graceful-shutdown';
export * from './child-process-utils';
export type { Logger } from 'pino';

export type CommonKeys<T, U> = {
    [K in keyof T & keyof U]: T[K] & U[K]
};
