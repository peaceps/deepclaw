import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {useMediaQuery, useWideLayout} from './use-media-query';

type Subscribe = (listener: () => void) => () => void;

/** The three pieces a hook of this kind is made of, which React is the one to put together. */
type Store = {
    subscribe: Subscribe;
    getSnapshot: () => boolean;
    getServerSnapshot: () => boolean;
};

/**
 * React is the one the hook talks to, and there is no renderer here to play that part: the store it
 * hands over is handed back as it is, to be read the way React reads it — the snapshot where there
 * is a viewport to measure, the server snapshot where there is none, and the subscription in
 * between to say the measurement no longer holds.
 */
vi.mock('react', () => ({
    useMemo: (factory: () => unknown) => factory(),
    useCallback: (callback: unknown) => callback,
    useSyncExternalStore: (
        subscribe: Subscribe, getSnapshot: () => boolean, getServerSnapshot: () => boolean
    ) => ({subscribe, getSnapshot, getServerSnapshot}),
}));

/** What a browser hands back for a query, as far as the hook looks into it. */
function newMediaQueryList(query: string) {
    const listeners = new Set<() => void>();
    const list = {
        query,
        matches: false,
        addEventListener: (type: string, listener: () => void) => {
            if (type === 'change') listeners.add(listener);
        },
        removeEventListener: (type: string, listener: () => void) => {
            if (type === 'change') listeners.delete(listener);
        },
        /** The viewport crossing the width the query names, and the browser saying so. */
        cross: (matches: boolean) => {
            list.matches = matches;
            listeners.forEach(listener => listener());
        },
    };
    return list;
}

type TestWindow = {matchMedia: (query: string) => unknown};

let asked: ReturnType<typeof newMediaQueryList>[] = [];

function giveViewport(): void {
    asked = [];
    (globalThis as {window?: TestWindow}).window = {
        matchMedia: (query: string) => {
            const list = newMediaQueryList(query);
            asked.push(list);
            return list;
        },
    };
}

function takeViewportAway(): void {
    delete (globalThis as {window?: TestWindow}).window;
}

/** The query last asked about, which is the one of the layout the test is looking at. */
function askedAbout(): ReturnType<typeof newMediaQueryList> {
    return asked[asked.length - 1];
}

/** Stands in for the component asking which layout to build, so the hook is called where it may be. */
function Layout(query = '(min-width: 700px)'): Store {
    return useMediaQuery(query) as unknown as Store;
}

function WideLayout(): Store {
    return useWideLayout() as unknown as Store;
}

describe('useMediaQuery', () => {

    beforeEach(giveViewport);

    afterEach(takeViewportAway);

    test('asks the browser about the query it was given', () => {
        Layout('(max-width: 480px)');
        expect(askedAbout().query).toBe('(max-width: 480px)');
    });

    test('reads a viewport the query matches as matching', () => {
        const store = Layout();
        askedAbout().matches = true;
        expect(store.getSnapshot()).toBe(true);
    });

    test('reads a viewport the query does not match as not matching', () => {
        expect(Layout().getSnapshot()).toBe(false);
    });

    test('tells React the moment the viewport crosses the width', () => {
        const store = Layout();
        const listener = vi.fn();
        store.subscribe(listener);
        askedAbout().cross(true);
        expect(listener).toHaveBeenCalledOnce();
    });

    test('reads the viewport the other way round once it crossed', () => {
        const store = Layout();
        store.subscribe(vi.fn());
        askedAbout().cross(true);
        expect(store.getSnapshot()).toBe(true);
    });

    test('says nothing more once React has let go', () => {
        const store = Layout();
        const listener = vi.fn();
        store.subscribe(listener)();
        askedAbout().cross(true);
        expect(listener).not.toHaveBeenCalled();
    });

    describe('without a viewport', () => {

        beforeEach(takeViewportAway);

        /** The markup of the server and of the hydrating client have to be the one thing. */
        test('takes a page rendered without a viewport for a narrow one', () => {
            expect(Layout().getServerSnapshot()).toBe(false);
        });

        test('has nothing to measure and reads it as narrow', () => {
            expect(Layout().getSnapshot()).toBe(false);
        });

        test('subscribes to a browser that is not there without minding', () => {
            expect(() => Layout().subscribe(vi.fn())()).not.toThrow();
        });
    });

    /**
     * The server snapshot is what the client renders while it hydrates, whatever the browser
     * showing it measures: a value of its own there would be markup the server never wrote.
     */
    test('keeps the server snapshot narrow for a wide viewport as well', () => {
        const store = Layout();
        askedAbout().matches = true;
        expect(store.getServerSnapshot()).toBe(false);
    });
});

describe('useWideLayout', () => {

    beforeEach(giveViewport);

    afterEach(takeViewportAway);

    /** The width the pages switch layout at, which is the one Tailwind's `lg:` prefix names. */
    test('asks about the width a layout has room for a chat beside what it is about', () => {
        WideLayout();
        expect(askedAbout().query).toBe('(min-width: 1024px)');
    });

    test('reads a viewport that wide as the wide layout', () => {
        const store = WideLayout();
        askedAbout().matches = true;
        expect(store.getSnapshot()).toBe(true);
    });
});
