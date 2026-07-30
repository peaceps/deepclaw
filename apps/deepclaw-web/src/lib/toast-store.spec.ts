import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {EXIT_MS, useToastStore, type ToastItem} from './toast-store';

type ShowInput = Parameters<ReturnType<typeof useToastStore.getState>['show']>[0];

const MAX_TOASTS = 5;

/** `show` types `type` as required even though the implementation defaults it, so the cast lives here. */
function show(input: Partial<ShowInput> & {message: string}): string {
    return useToastStore.getState().show(input as ShowInput);
}

function toasts(): ToastItem[] {
    return useToastStore.getState().toasts;
}

function fill(count: number): void {
    for (let index = 0; index < count; index++) {
        show({message: `message ${index}`});
    }
}

describe('useToastStore', () => {

    beforeEach(() => {
        useToastStore.setState({toasts: []});
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('show', () => {

        test('queues a toast with the given message', () => {
            show({message: 'saved'});
            expect(toasts()).toEqual([{id: expect.any(String), type: 'info', message: 'saved', duration: 4000}]);
        });

        test('returns the id it queued the toast under', () => {
            const id = show({message: 'saved'});
            expect(toasts()[0].id).toBe(id);
        });

        test('generates a unique id per toast', () => {
            const ids = [show({message: 'a'}), show({message: 'b'}), show({message: 'c'})];
            expect(new Set(ids).size).toBe(3);
        });

        test('keeps an id that was given', () => {
            expect(show({id: 'fixed', message: 'saved'})).toBe('fixed');
        });

        test('queues a second toast under an id that is already taken', () => {
            show({id: 'fixed', message: 'first'});
            show({id: 'fixed', message: 'second'});
            expect(toasts()).toHaveLength(2);
        });

        test('defaults the type to info', () => {
            show({message: 'saved'});
            expect(toasts()[0].type).toBe('info');
        });

        test('keeps the given type and title', () => {
            show({type: 'error', title: 'Oops', message: 'broken'});
            expect(toasts()[0]).toMatchObject({type: 'error', title: 'Oops', message: 'broken'});
        });

        test('defaults the duration to four seconds', () => {
            show({message: 'saved'});
            expect(toasts()[0].duration).toBe(4000);
        });

        test('keeps an explicit duration', () => {
            show({message: 'saved', duration: 100});
            expect(toasts()[0].duration).toBe(100);
        });

        test('keeps a zero duration for a toast that has to be closed by hand', () => {
            show({message: 'saved', duration: 0});
            expect(toasts()[0].duration).toBe(0);
        });

        test('appends toasts in the order they arrived', () => {
            fill(3);
            expect(toasts().map(toast => toast.message)).toEqual(['message 0', 'message 1', 'message 2']);
        });

        test('queues nothing as leaving', () => {
            show({message: 'saved'});
            expect(toasts()[0].leaving).toBeUndefined();
        });
    });

    describe('overflow', () => {

        beforeEach(() => {
            vi.useFakeTimers();
        });

        test('keeps the whole queue up to the limit', () => {
            fill(MAX_TOASTS);
            expect(toasts().every(toast => !toast.leaving)).toBe(true);
        });

        test('marks the oldest toast as leaving beyond the limit', () => {
            fill(MAX_TOASTS + 1);
            expect(toasts()).toHaveLength(MAX_TOASTS + 1);
            expect(toasts()[0]).toMatchObject({message: 'message 0', leaving: true});
        });

        test('removes the leaving toast once the exit animation is over', () => {
            fill(MAX_TOASTS + 1);
            vi.advanceTimersByTime(EXIT_MS);
            expect(toasts().map(toast => toast.message)).toEqual([
                'message 1', 'message 2', 'message 3', 'message 4', 'message 5',
            ]);
        });

        test('keeps the leaving toast until the exit animation is over', () => {
            fill(MAX_TOASTS + 1);
            vi.advanceTimersByTime(EXIT_MS - 1);
            expect(toasts()).toHaveLength(MAX_TOASTS + 1);
        });

        test('does not count leaving toasts against the limit', () => {
            fill(MAX_TOASTS + 2);
            expect(toasts().filter(toast => toast.leaving).map(toast => toast.message))
                .toEqual(['message 0', 'message 1']);
        });

        test('survives a toast that was dismissed before its exit timer fired', () => {
            fill(MAX_TOASTS + 1);
            useToastStore.getState().dismiss(toasts()[0].id);
            vi.advanceTimersByTime(EXIT_MS);
            expect(toasts()).toHaveLength(MAX_TOASTS);
        });
    });

    describe('dismiss', () => {

        test('removes the toast with that id', () => {
            const id = show({message: 'first'});
            show({message: 'second'});
            useToastStore.getState().dismiss(id);
            expect(toasts().map(toast => toast.message)).toEqual(['second']);
        });

        test('removes every toast sharing an id', () => {
            show({id: 'fixed', message: 'first'});
            show({id: 'fixed', message: 'second'});
            useToastStore.getState().dismiss('fixed');
            expect(toasts()).toEqual([]);
        });

        test('leaves the queue alone for an unknown id', () => {
            show({message: 'saved'});
            useToastStore.getState().dismiss('ghost');
            expect(toasts()).toHaveLength(1);
        });
    });

    describe('clear', () => {

        test('empties the queue', () => {
            fill(3);
            useToastStore.getState().clear();
            expect(toasts()).toEqual([]);
        });

        test('does nothing on an empty queue', () => {
            useToastStore.getState().clear();
            expect(toasts()).toEqual([]);
        });
    });
});
