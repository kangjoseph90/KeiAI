import type { Table } from 'dexie';
import { localRecordChanged, type LocalUpdateClock, type LocalUpdateRecord } from './index';

/** Call inside a transaction containing both the records and the clock table. */
export async function putLocalUpdates<T extends LocalUpdateRecord & { id: string }>(
    table: Table<T, string>,
    updates: Table<LocalUpdateClock, string>,
    records: T[]
): Promise<string[]> {
    let value = (await updates.get('clock'))?.value ?? 0;
    const changed: string[] = [];
    for (const record of records) {
        const before = await table.get(record.id);
        if (!localRecordChanged(before, record)) continue;
        await table.put({ ...record, localUpdatedAt: ++value });
        changed.push(record.id);
    }
    if (changed.length > 0) await updates.put({ id: 'clock', value });
    return changed;
}
