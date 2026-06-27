export function globalize<T>(key: string, value: T): typeof value {
    const globalKey = `__${key}`;
    const globalForGlobalize = globalThis as typeof globalThis & {
        [globalKey]?: typeof value;
    };
    return (globalForGlobalize[globalKey] ??= value);
}
