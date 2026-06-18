export function globalize<T>(key: string, clazz: T): typeof clazz {
    const globalKey = `__${key}`;
    const globalForGlobalize = globalThis as typeof globalThis & {
        [globalKey]?: typeof clazz;
    };
    return (globalForGlobalize[globalKey] ??= clazz);
}
