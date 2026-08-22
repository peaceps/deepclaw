'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

/* ------------------------------------------------------------------ *
 * The layout a page is rendered for, read from the viewport.          *
 *                                                                     *
 * Most of the app switches layout with the `lg:` classes, which is    *
 * cheaper and needs no width to render: markup for both layouts is    *
 * there and the browser shows one. A subtree with a life of its own   *
 * cannot be hidden that way, because hidden markup still runs its     *
 * effects — two chats of one loop, both listening, both pulling.      *
 * Those pages ask here which layout to build in the first place.      *
 *                                                                     *
 * The server has no viewport, so it renders `getServerSnapshot` and   *
 * the hydrating client renders the same, React switching to the real  *
 * value right after. The default is the narrow layout: it is the one  *
 * that starts with a list rather than a chat, so the frame that is    *
 * thrown away costs nothing more than the markup of a list.           *
 * ------------------------------------------------------------------ */

/** The width Tailwind's `lg:` prefix switches at, which is where the pages change layout. */
const WIDE_LAYOUT_QUERY = '(min-width: 1024px)';

const narrowOnTheServer = () => false;

export function useMediaQuery(query: string): boolean {
    const list = useMemo(
        () => typeof window === 'undefined' ? null : window.matchMedia(query),
        [query]
    );
    const subscribe = useCallback((listener: () => void) => {
        list?.addEventListener('change', listener);
        return () => list?.removeEventListener('change', listener);
    }, [list]);
    const getSnapshot = useCallback(() => !!list?.matches, [list]);

    return useSyncExternalStore(subscribe, getSnapshot, narrowOnTheServer);
}

/** True where the page has the room to put the chat beside what it is about. */
export function useWideLayout(): boolean {
    return useMediaQuery(WIDE_LAYOUT_QUERY);
}
