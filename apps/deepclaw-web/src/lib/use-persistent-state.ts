'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

/* ------------------------------------------------------------------ *
 * UI state that survives a reload, kept in localStorage.              *
 *                                                                     *
 * The stored value is exposed through useSyncExternalStore, so the    *
 * server and the hydrating client both render `getServerSnapshot`     *
 * (no stored value, i.e. the default) and React itself switches to    *
 * the real value afterwards. The markup matches on both sides at the  *
 * cost of one frame showing the default.                              *
 *                                                                     *
 * A setter does not write to the store directly: it records an        *
 * override in React state, and an effect persists it. That keeps the  *
 * setters callable during render — ProjectBoard expands the           *
 * deep-linked project that way — and lets an override placed before   *
 * hydration survive the stored value arriving later.                  *
 *                                                                     *
 * There is deliberately no `storage` event listener. An override      *
 * shadows the store for the rest of the component's life, so          *
 * cross-tab updates would only arrive until the user first touches    *
 * the control, which is more confusing than not syncing at all.       *
 * ------------------------------------------------------------------ */

type Box<T> = { value: T };

const rawByKey = new Map<string, string | null>();
const listenersByKey = new Map<string, Set<() => void>>();

function readRaw(key: string): string | null {
    if (!rawByKey.has(key)) {
        try { rawByKey.set(key, window.localStorage.getItem(key)); }
        catch { rawByKey.set(key, null); }
    }
    return rawByKey.get(key) ?? null;
}

function writeRaw(key: string, raw: string): void {
    rawByKey.set(key, raw);
    try { window.localStorage.setItem(key, raw); } catch { /* ignore */ }
    listenersByKey.get(key)?.forEach(listener => listener());
}

function subscribeToKey(key: string, listener: () => void): () => void {
    let listeners = listenersByKey.get(key);
    if (!listeners) {
        listeners = new Set();
        listenersByKey.set(key, listeners);
    }
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function parseRaw<T>(raw: string | null, accept: (parsed: unknown) => Box<T> | null): Box<T> | null {
    if (raw === null) return null;
    try { return accept(JSON.parse(raw)); } catch { return null; }
}

const noStoredValue = () => null;

function usePersistentValue<T>(
    key: string,
    defaultValue: T,
    accept: (parsed: unknown) => Box<T> | null,
) {
    const subscribe = useCallback((listener: () => void) => subscribeToKey(key, listener), [key]);
    const getSnapshot = useCallback(() => readRaw(key), [key]);
    const raw = useSyncExternalStore(subscribe, getSnapshot, noStoredValue);

    const stored = useMemo(() => parseRaw(raw, accept), [raw, accept]);

    const [override, setOverride] = useState<Box<T> | null>(null);
    const base = stored ? stored.value : defaultValue;
    const value = override ? override.value : base;

    useEffect(() => {
        if (!override) return;
        // undefined has no JSON form, so it is stored as null
        writeRaw(key, JSON.stringify(override.value ?? null));
    }, [key, override]);

    /**
     * The base read out of the store at the moment it is wanted, rather than the one this render
     * happens to be holding.
     *
     * A setter closed over the base is a new setter every time a value is written, the write going
     * to the store and coming back out of it as a new base. These are handed down to children that
     * hold still only for as long as what they are handed does -- the project board gives one
     * toggle to every row that way -- and a setter that changed under them would redraw the lot.
     * Nothing is lost by reading late: this is only ever reached before the first write of this
     * component's life, and the store is where the value that render read came from anyway.
     */
    const readBase = useCallback(() => {
        const box = parseRaw(readRaw(key), accept);
        return box ? box.value : defaultValue;
    }, [key, accept, defaultValue]);

    const set = useCallback((next: T | ((prev: T) => T)) => {
        setOverride(prev => ({
            value: typeof next === 'function'
                ? (next as (prev: T) => T)(prev ? prev.value : readBase())
                : next,
        }));
    }, [readBase]);

    return [value, set] as const;
}

function acceptBoolean(parsed: unknown): Box<boolean> | null {
    return typeof parsed === 'boolean' ? { value: parsed } : null;
}

function acceptString(parsed: unknown): Box<string | undefined> | null {
    if (parsed === null) return { value: undefined };
    return typeof parsed === 'string' ? { value: parsed } : null;
}

export function usePersistentBoolean(key: string, defaultValue: boolean) {
    const [value, set] = usePersistentValue<boolean>(key, defaultValue, acceptBoolean);
    const toggle = useCallback(() => set(prev => !prev), [set]);

    return [value, toggle, set] as const;
}

export function usePersistentString(key: string, defaultValue?: string) {
    return usePersistentValue<string | undefined>(key, defaultValue, acceptString);
}
