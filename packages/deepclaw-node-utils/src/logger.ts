import pino from 'pino'
import { FileUtils } from './file-utils';

/**
 * How many log files are kept, the oldest going as a new one is opened.
 *
 * There is one per process and nothing ever took one away, so this folder grew for as long as
 * deepclaw was installed rather than with anything anybody did: an install of ours had four and a
 * half thousand of them in it, all but a couple of hundred empty. Fifty covers the processes of a
 * running install several times over, which is as far back as a log of this kind is ever read.
 *
 * A count and not a promise, in both directions. Several processes starting at once each see the
 * same folder and each make the same room, so the moment after holds fifty and a few, settled by
 * the next start; and a log still being written is never thrown away, so a machine running more
 * than fifty of ours at once keeps a file for each of them.
 */
export const MAX_LOG_FILES = 50;

// a packaged web server runs from inside its own installation, so the logs are placed by hand
const LOG_DIR = `${FileUtils.getWorkingDir()}/.logs`;

let logger: pino.Logger | null = null;

/**
 * What a log file is called, and where in the name the pid is: written by `rootLogger` below, read
 * back by `stillRunning`, the name being all anybody knows about a file they are about to delete.
 */
const LOG_FILE_NAME = /^runtime_\d+_(\d+)\.log$/;

/**
 * Whether the process whose log this is is still running, which is asked before the file is thrown
 * away.
 *
 * A log unlinked under a running process is not a log freed: on linux the delete goes through and
 * the process goes on writing to a file nothing can open again, so its lines are lost rather than
 * rotated. Windows refuses the delete outright and made that safe by accident -- the delete fails,
 * the file is passed over. This is the same answer arrived at on purpose, and the reason a pid is
 * in the name.
 *
 * The defence the age of a file gives is thinner than it looks, which is why this is worth asking:
 * a file is only as new as the last line written to it, and a process that has been idle all night
 * -- a web server, most likely of all -- has the oldest file here while still needing it.
 *
 * A pid handed out again since reads as alive, and pids do come round: they wrap at the top of the
 * range the system allows -- four million on a modern linux, thirty two thousand on plenty of
 * others -- so a machine busy for long enough arrives there without ever being rebooted. What it
 * costs is that the file stays until whatever holds the pid now exits, this being asked afresh on
 * every start, and the folder is cut back by the files around it in the meantime.
 */
function stillRunning(fileName: string): boolean {
    // Nothing but digits is read, and a zero is turned away with the names that parse to nothing at
    // all: zero and below are not pids but ways of naming a whole process group.
    const pid = Number(LOG_FILE_NAME.exec(fileName)?.[1]);
    if (!pid) {
        return false;
    }
    try {
        // A signal of nothing asks after a process without touching it, and being refused is an
        // answer of its own: the process is somebody else's, which is to say it is there.
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as {code?: string}).code === 'EPERM';
    }
}

/**
 * The one logger of the process, opened when the first thing is asked of it rather than when this
 * module is imported.
 *
 * Which is where the empty files came from: a logger is asked for at the top of a module, so every
 * process that imported anything of ours opened a file of its own, and building the web app alone
 * spawns a good many that never have a line to write. Waiting means a file exists because something
 * was said to it, and the moment it is named after is that.
 */
function rootLogger(): pino.Logger {
    if (logger === null) {
        // Room for the one about to be opened, and nothing thrown away that is still being written
        // to. This cannot raise, whatever the state of the folder: the first line of a process is
        // usually a line in a catch block, and an error about the logs would stand in for it.
        FileUtils.enforceFileCountLimit(LOG_DIR, MAX_LOG_FILES - 1, stillRunning);
        logger = pino({
            level: process.env['NODE_ENV'] !== 'production' ? 'debug' : 'warn',
            base: { pid: process.pid },
            timestamp: pino.stdTimeFunctions.isoTime,
            transport: {
                target: 'pino/file',
                options: {
                    // Spelled to match `LOG_FILE_NAME`, which is how the pid gets read back out.
                    destination: `${LOG_DIR}/runtime_${FileUtils.timestamp()}_${process.pid}.log`,
                    mkdir: true
                }
            }
        });
    }
    return logger;
}

/**
 * A logger carrying these bindings, which reaches for the one behind it on the first thing asked of
 * it and not before.
 *
 * The first thing asked, not the first thing written: a level read at the top of a module opens the
 * file as surely as a line logged would. What is asked of a logger here is `error`, `warn` or
 * `info`, each of them where something has happened, so a file still exists because there is
 * something in it -- but `const {info} = getLogger(...)` beside an import would quietly put the
 * empty files back, and nothing would fail to say so.
 *
 * A proxy rather than the three methods anybody calls, so that the whole of pino stays reachable
 * through it. It stands in for the logger and not for the object: asked for something by name it
 * answers, `in` included, while a spread of it or a list of its keys says nothing about it.
 */
function lazyLogger(bindings: pino.Bindings): pino.Logger {
    let child: Record<string | symbol, unknown> | undefined;
    const bound = new Map<string | symbol, unknown>();
    const resolve = (): Record<string | symbol, unknown> =>
        child ??= rootLogger().child(bindings) as unknown as Record<string | symbol, unknown>;
    return new Proxy({} as pino.Logger, {
        get: (_, property) => {
            const logger = resolve();
            const value = logger[property];
            if (typeof value !== 'function') {
                return value;
            }
            // Bound to the logger, pino reading the level to write at and the stream to write to
            // off `this`; and the same one every time, a method of a logger being a thing somebody
            // may reasonably hold on to or compare.
            if (!bound.has(property)) {
                bound.set(property, value.bind(logger));
            }
            return bound.get(property);
        },
        has: (_, property) => Reflect.has(resolve(), property),
        set: (_, property, value) => {
            bound.delete(property);
            return Reflect.set(resolve(), property, value);
        },
    });
}

export function getLogger(name: string) {
    return lazyLogger({
        name
    });
}

/** A spawned loop shares the id of the loop it came out of, its run id is what tells them apart. */
export function getLoopLogger(loopId: string, runId?: string) {
    return lazyLogger({
        loopId,
        runId
    });
}
