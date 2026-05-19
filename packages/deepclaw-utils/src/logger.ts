import pino from 'pino'

const isDev = process.env['NODE_ENV'] !== 'production'

const logger = pino({
  level: isDev ? 'debug' : 'warn',

  base: {
    pid: process.pid
  },

  timestamp: pino.stdTimeFunctions.isoTime,

  transport: isDev
    ? {
        targets: [
        //   {
        //     target: 'pino-pretty'
        //   },
          {
            target: 'pino/file',
            options: {
              destination: './.logs/runtime.log',
              mkdir: true
            }
          }
        ]
      }
    : {
        target: 'pino/file',
        options: {
          destination: './.logs/runtime.log',
          mkdir: true
        }
      }
});

export function getLogger(parentSessionId: string, sessionId: string, loopId: string) {
  return logger.child({
    parentSessionId,
    sessionId,
    loopId
  });
}