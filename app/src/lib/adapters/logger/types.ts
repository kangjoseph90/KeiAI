export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface Logger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

export type LoggerFactory = (namespace?: string) => Logger;

export interface ILoggerAdapter {
    createLogger(namespace?: string): Logger;
}
