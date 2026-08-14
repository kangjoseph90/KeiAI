import { subscribeLogs, type LogEntry } from '$lib/adapters/logger';
import { systemLogs } from './state';

export const MAX_SYSTEM_LOGS = 500;

// Subscribe to incoming logger events and maintain a FIFO ring buffer
subscribeLogs((entry: LogEntry) => {
    systemLogs.update((logs) => {
        if (logs.length >= MAX_SYSTEM_LOGS) {
            return [...logs.slice(logs.length - MAX_SYSTEM_LOGS + 1), entry];
        }
        return [...logs, entry];
    });
});

export function clearSystemLogs(): void {
    systemLogs.set([]);
}
