export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface Logger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

export interface LogEntry {
    id: string;
    timestamp: Date;
    level: LogLevel;
    namespace?: string;
    message: string;
}

export type LogListener = (entry: LogEntry) => void;

export interface ILoggerAdapter {
    createLogger(namespace?: string): Logger;
    subscribe(listener: LogListener): () => void;
}
