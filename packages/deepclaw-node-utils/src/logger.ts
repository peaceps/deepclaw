import pino from 'pino'
import { FileUtils } from './file-utils';

// a packaged web server runs from inside its own installation, so the logs are placed by hand
const LOG_FILE = `${FileUtils.getWorkingDir()}/.logs/runtime_${
    new Date().toISOString().replace(/[\-TZ\.:]/g, '')}.log`;

let logger: pino.Logger | null = null;

function geRootLogger() {
    if (logger === null) {
        logger = pino({
            level: process.env['NODE_ENV'] !== 'production' ? 'debug' : 'warn',
            base: { pid: process.pid },
            timestamp: pino.stdTimeFunctions.isoTime,
            transport: {
                target: 'pino/file',
                options: {
                    destination: LOG_FILE,
                    mkdir: true
                }
            }
        });
    }
    return logger;
}

export function getLogger(name: string) {
    return geRootLogger().child({
        name
    });
}

/** A spawned loop shares the id of the loop it came out of, its run id is what tells them apart. */
export function getLoopLogger(loopId: string, runId?: string) {
    return geRootLogger().child({
        loopId,
        runId
    });
}
