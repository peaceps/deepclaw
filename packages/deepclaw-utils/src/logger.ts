import pino from 'pino'

const LOG_FILE = `./.logs/runtime_${new Date().toISOString().replace(/[\-TZ\.:]/g, '')}.log`;

const logger = pino({
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

export function getLogger(name: string) {
    return logger.child({
        name
    });
}

export function getLoopLogger(parentSessionId: string, sessionId: string, loopId: string) {
    return logger.child({
        parentSessionId,
        sessionId,
        loopId
    });
}
