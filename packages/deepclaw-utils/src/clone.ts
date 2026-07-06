export function mergeAbsence<T extends Record<string, any>>(
    target: T, source: T, converter: (key: any, value: any) => any = (_, v) => v
): T {

    Object.keys(source).forEach(key => {
        const k = key as keyof T;
        const sourceValue = source[k];
        const targetValue = target[k];

        if (Array.isArray(sourceValue)) {
            if (!targetValue || !Array.isArray(targetValue)) {
                target[k] = sourceValue.map((v: any) => {
                    return typeof v === 'object' ? clone(v, converter) : converter(k, v);
                });
            }
        } else if (sourceValue !== null && typeof sourceValue === 'object') {
            if (typeof targetValue !== 'object' || targetValue === null) {
                target[k] = {} as T[keyof T];
            }
            mergeAbsence(target[k] as T, sourceValue as T, converter);
        } else {
            target[k] = targetValue ?? converter(k, sourceValue);
        }
    });
    return target;
}

export function clone<T extends Record<string, any>>(source: T, converter?: (key: string, value: any) => any): T {
    return mergeAbsence<T>({} as T, source, converter);
}
