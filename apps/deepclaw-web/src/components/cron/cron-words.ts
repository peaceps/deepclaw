import type { SupportedLanguage } from '@deepclaw/i18n';
// The clock itself, not the whole of the package: `cron` reaches child_process through the job it
// builds, and nothing of that belongs in a browser. What is wanted here is the reading of an
// expression, which is `CronTime` and luxon and no more.
import { CronTime } from 'cron/dist/time.js';
import { translateCron } from '@/components/component-utils';

/**
 * What can be said of a schedule before it is saved: whether the clock that would run it takes the
 * expression, and what it says where anything can be said of it.
 *
 * Two answers rather than one because they come from two readers and the readers disagree. The
 * clock is the one that matters -- an expression it refuses is a task that would not run -- and the
 * words come from a describer that reads a wider language than the clock does: `0 0 L * *` and
 * `0 0 * * 1#2` are Quartz, described here in perfectly good english and refused by this clock, and
 * anybody coming from Spring writes the first of those from memory. So the describer is not allowed
 * to say whether a schedule is good. It only says what a good one means.
 *
 * The other way round happens too and is harmless: `@weekdays` and `@minutely` are the clock's own
 * shorthands and the describer has never heard of them, so they are saved with nothing said of them.
 */
export type ScheduleReading = {
    /** The clock takes this expression, so it is a schedule that can be saved. */
    schedulable: boolean;
    /** What it says, in the language it was read in, where it can be put into words at all. */
    words?: string;
};

/** Nothing typed yet is no schedule, and no complaint either until there is something to complain of. */
const NOTHING: ScheduleReading = {schedulable: false};

export function readSchedule(lang: SupportedLanguage, cron: string): ScheduleReading {
    const written = cron.trim().replace(/\s+/g, ' ');
    if (!written) {
        return NOTHING;
    }
    if (!CronTime.validateCronExpression(written).valid) {
        return NOTHING;
    }
    try {
        // The clock takes a shorthand however it is capitalised and the describer only in lower
        // case, so it is read down here rather than left unsaid for the case somebody typed it in.
        return {
            schedulable: true,
            words: translateCron(lang, written.startsWith('@') ? written.toLowerCase() : written),
        };
    } catch {
        // What is thrown carries no message worth passing on -- and none in the reader's language.
        // The schedule stands: it is the clock that runs it, not the describer.
        return {schedulable: true};
    }
}

/**
 * A schedule as it is shown on a task that already has one, which is its words where it has any and
 * the expression itself where it has none.
 *
 * The fallback is not for show. An agent writes these through a tool of its own and the clock's
 * shorthands go through it, so a row on this page can be carrying an expression no describer will
 * read -- and the describer throws rather than shrugging, which from a render is the whole page
 * rather than one line of it.
 */
export function scheduleText(lang: SupportedLanguage, cron: string): string {
    return readSchedule(lang, cron).words ?? cron;
}
