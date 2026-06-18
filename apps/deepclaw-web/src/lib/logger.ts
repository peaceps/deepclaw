import pino from 'pino';

let logger: pino.Logger | null = null;

function getRootLogger(): pino.Logger {
    if (logger === null) {
        logger = pino({
            level: 'info',
            browser: {
                asObject: true,
                serialize: true,
                write: console.log,
            }
        });
    }
    return logger;
}

export function getLogger(name: string) {
    return getRootLogger().child({
        name
    });
}
