import { BaseDirectory } from '@tauri-apps/api/path';
import { exists, mkdir, readDir, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import type { ILoggerAdapter, Logger, LogLevel } from './types';

const LOG_DIR = 'logs';
const RETENTION_DAYS = 7;

function getDatePart(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getTimePart(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function formatLine(level: LogLevel, namespace: string | undefined, args: unknown[]): string {
    const now = new Date();
    const prefix = namespace
        ? `[${getTimePart(now)}][${level}][${namespace}]`
        : `[${getTimePart(now)}][${level}]`;
    const text = args
        .map((arg) => {
            if (typeof arg === 'string') return arg;
            try {
                return JSON.stringify(arg);
            } catch {
                return String(arg);
            }
        })
        .join(' ');
    return `${prefix} ${text}`.trim();
}

class TauriLogger implements Logger {
    constructor(
        private readonly namespace: string | undefined,
        private readonly sink: (
            level: LogLevel,
            namespace: string | undefined,
            args: unknown[]
        ) => void
    ) {}

    debug(...args: unknown[]): void {
        this.sink('DEBUG', this.namespace, args);
    }

    info(...args: unknown[]): void {
        this.sink('INFO', this.namespace, args);
    }

    warn(...args: unknown[]): void {
        this.sink('WARN', this.namespace, args);
    }

    error(...args: unknown[]): void {
        this.sink('ERROR', this.namespace, args);
    }
}

export class TauriLoggerAdapter implements ILoggerAdapter {
    private retentionInitialized = false;

    createLogger(namespace?: string): Logger {
        return new TauriLogger(namespace, (level, ns, args) => {
            void this.write(level, ns, args);
        });
    }

    private async ensureLogDir(): Promise<void> {
        if (!(await exists(LOG_DIR, { baseDir: BaseDirectory.AppData }))) {
            await mkdir(LOG_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
        }
    }

    private async cleanupOldLogs(now: Date): Promise<void> {
        await this.ensureLogDir();
        const entries = await readDir(LOG_DIR, { baseDir: BaseDirectory.AppData });
        const cutoff = new Date(now);
        cutoff.setHours(0, 0, 0, 0);
        cutoff.setDate(cutoff.getDate() - (RETENTION_DAYS - 1));

        for (const entry of entries) {
            if (!entry.isFile || !entry.name.endsWith('.log')) continue;
            const datePart = entry.name.replace(/\.log$/, '');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) continue;
            const fileDate = new Date(`${datePart}T00:00:00`);
            if (Number.isNaN(fileDate.getTime())) continue;
            if (fileDate < cutoff) {
                await remove(`${LOG_DIR}/${entry.name}`, { baseDir: BaseDirectory.AppData });
            }
        }
    }

    private async appendLine(line: string, date: Date): Promise<void> {
        await this.ensureLogDir();
        const filePath = `${LOG_DIR}/${getDatePart(date)}.log`;
        const nextLine = `${line}\n`;
        await writeTextFile(filePath, nextLine, {
            baseDir: BaseDirectory.AppData,
            append: true
        });
    }

    private async write(
        level: LogLevel,
        namespace: string | undefined,
        args: unknown[]
    ): Promise<void> {
        const now = new Date();
        const line = formatLine(level, namespace, args);
        try {
            if (!this.retentionInitialized) {
                await this.cleanupOldLogs(now);
                this.retentionInitialized = true;
            }
            await this.appendLine(line, now);
        } catch (error) {
            console.error('[KeiAI][ERROR][logger] Failed to write Tauri log', error);
        }
    }
}
