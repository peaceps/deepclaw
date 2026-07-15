import pino from 'pino'

const LOG_FILE = `./.logs/runtime_${new Date().toISOString().replace(/[\-TZ\.:]/g, '')}.log`;

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

export function getLoopLogger(loopId: string, subLoopId?: string) {
    return geRootLogger().child({
        loopId,
        subLoopId
    });
}
