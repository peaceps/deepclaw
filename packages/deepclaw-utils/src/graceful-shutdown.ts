function withCleanup(onShutdown: () => void): (signal: string, code?: number) => void {
    let isShuttingDown = false;

    return function gracefulShutdown(signal: string, code: number = 0): void {
        if (isShuttingDown) return;
        isShuttingDown = true;
    
        // TODO: 记录日志优化
        console.info('exit:', signal);
        try {
            onShutdown();
            process.exit(code);
        } catch (err) {
            console.error('error:', err);
            process.exit(1);
        }
    }
}

export function cleanupOnShutdown(cleanup: () => void): void {
    const gracefulShutdown = withCleanup(cleanup);

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('uncaughtException', () => {
      gracefulShutdown('uncaughtException', 1);
    });
}