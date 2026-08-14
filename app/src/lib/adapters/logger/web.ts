import type { ILoggerAdapter, LogEntry, Logger, LogListener, LogLevel } from './types';

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

function formatArgs(args: unknown[]): string {
    return args
        .map((arg) => {
            if (typeof arg === 'string') return arg;
            if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
            try {
                return JSON.stringify(arg);
            } catch {
                return String(arg);
            }
        })
        .join(' ');
}

class WebLogger implements Logger {
    constructor(
        private readonly namespace: string | undefined,
        private readonly notify: (
            level: LogLevel,
            namespace: string | undefined,
            args: unknown[]
        ) => void
    ) {}

    private log(level: LogLevel, ...args: unknown[]): void {
        const method = getConsoleMethod(level);
        const [first, ...rest] = args;
        const prefix = formatPrefix(level, this.namespace);
        if (typeof first === 'string') {
            method(`${prefix} ${first}`, ...rest);
        } else if (first === undefined) {
            method(prefix);
        } else {
            method(prefix, first, ...rest);
        }
        this.notify(level, this.namespace, args);
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
    private readonly listeners = new Set<LogListener>();
    private seq = 0;

    createLogger(namespace?: string): Logger {
        return new WebLogger(namespace, (level, ns, args) => {
            this.emit(level, ns, args);
        });
    }

    subscribe(listener: LogListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(level: LogLevel, namespace: string | undefined, args: unknown[]): void {
        const entry: LogEntry = {
            id: `${Date.now()}-${++this.seq}`,
            timestamp: new Date(),
            level,
            namespace,
            message: formatArgs(args)
        };
        for (const listener of this.listeners) {
            try {
                listener(entry);
            } catch (err) {
                console.error('[KeiAI][ERROR][logger] Web logger listener failed', err);
            }
        }
    }
}
