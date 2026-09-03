import {describe, expect, test} from 'vitest';
import {readSchedule, scheduleText} from './cron-words';

describe('readSchedule', () => {

    test('says a schedule in the language it is read in', () => {
        expect(readSchedule('en', '0 9 * * 1'))
            .toEqual({schedulable: true, words: 'At 09:00 AM, only on Monday'});
        expect(readSchedule('zh', '0 0 * * *')).toEqual({schedulable: true, words: '在上午 12:00'});
    });

    test('reads an expression written in seconds as well', () => {
        expect(readSchedule('en', '*/30 * * * * *'))
            .toEqual({schedulable: true, words: 'Every 30 seconds'});
    });

    test('takes the spacing as it is typed', () => {
        expect(readSchedule('en', '  0   9  *  *  1 ').words).toBe('At 09:00 AM, only on Monday');
    });

    test('has nothing to say of an empty box', () => {
        expect(readSchedule('en', '   ')).toEqual({schedulable: false});
    });

    test('refuses words that are no schedule', () => {
        expect(readSchedule('en', 'every monday morning').schedulable).toBe(false);
        expect(readSchedule('en', '61 * * * *').schedulable).toBe(false);
        expect(readSchedule('en', '0 0 * * 8').schedulable).toBe(false);
        expect(readSchedule('en', '0 9 * *').schedulable).toBe(false);
    });

    /**
     * The whole of why the clock is asked rather than the describer. Every one of these is read out
     * in fluent english by the describer and refused by the clock that would have to run it, and
     * the first is what somebody who has written Quartz schedules types from memory.
     */
    test('refuses the schedules another clock would take', () => {
        for (const quartz of ['0 0 L * *', '0 0 * * 1#2', '0 0 * * 6L', '0 0 LW * *']) {
            expect(readSchedule('en', quartz)).toEqual({schedulable: false});
        }
    });

    test('refuses a step of zero and an empty item in a list', () => {
        for (const bad of ['*/0 * * * *', '5/0 * * * *', '0,,1 * * * *']) {
            expect(readSchedule('en', bad)).toEqual({schedulable: false});
        }
    });

    test('refuses a shorthand this clock does not know, and one field too many', () => {
        expect(readSchedule('en', '@reboot')).toEqual({schedulable: false});
        expect(readSchedule('en', '1 2 3 4 5 6 7')).toEqual({schedulable: false});
    });

    test('says the shorthands both readers know, in any case they are typed', () => {
        expect(readSchedule('en', '@daily').words).toBe('At 12:00 AM');
        expect(readSchedule('en', '@HOURLY').words).toBe('Every hour');
    });

    /** The clock's own shorthands, which the describer has never heard of: saved, and left unsaid. */
    test('keeps a schedule the clock knows and the describer cannot say', () => {
        expect(readSchedule('en', '@weekdays')).toEqual({schedulable: true});
        expect(readSchedule('en', '@minutely')).toEqual({schedulable: true});
    });
});

describe('scheduleText', () => {

    test('shows the words of a schedule that has them', () => {
        expect(scheduleText('en', '0 0 * * *')).toBe('At 12:00 AM');
    });

    /** What a row would otherwise render nothing at all with, the describer throwing on the way. */
    test('shows the expression itself where nothing can be said of it', () => {
        expect(scheduleText('en', '@weekdays')).toBe('@weekdays');
        expect(scheduleText('en', 'not a cron')).toBe('not a cron');
    });
});
