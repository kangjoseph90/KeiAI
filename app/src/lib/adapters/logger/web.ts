import type { ILoggerAdapter, Logger, LogLevel } from './types';

function getConsoleMethod(level: LogLevel): (...args: unknown[]) => void {
    switch (level) {
        case 'DEBUG':
            return (...args: unknown[]) => console.debug(...args);
        case 'INFO':
            return (...args: unknown[]) => console.info(...args);
        case 'WARN':
            return (...args: unknown[]) => console.warn(...args);
        case 'ERROR':
            return (...args: unknown[]) => console.error(...args);
    }
}

function formatPrefix(level: LogLevel, namespace?: string): string {
    return namespace ? `[KeiAI][${level}][${namespace}]` : `[KeiAI][${level}]`;
}

class WebLogger implements Logger {
    constructor(private readonly namespace?: string) {}

    private log(level: LogLevel, ...args: unknown[]): void {
        const method = getConsoleMethod(level);
        const [first, ...rest] = args;
        const prefix = formatPrefix(level, this.namespace);
        if (typeof first === 'string') {
            method(`${prefix} ${first}`, ...rest);
            return;
        }
        if (first === undefined) {
            method(prefix);
            return;
        }
        method(prefix, first, ...rest);
    }

    debug(...args: unknown[]): void {
        this.log('DEBUG', ...args);
    }

    info(...args: unknown[]): void {
        this.log('INFO', ...args);
    }

    warn(...args: unknown[]): void {
        this.log('WARN', ...args);
    }

    error(...args: unknown[]): void {
        this.log('ERROR', ...args);
    }
}

export class WebLoggerAdapter implements ILoggerAdapter {
    createLogger(namespace?: string): Logger {
        return new WebLogger(namespace);
    }
}
