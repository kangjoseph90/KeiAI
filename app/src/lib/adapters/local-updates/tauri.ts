/** Shared by content and multi metadata in KeiLocalDB.db. No schema upgrade/backfill. */
export const LOCAL_UPDATE_CLOCK_SQL = `
    CREATE TABLE IF NOT EXISTS local_update_clock (id INTEGER PRIMARY KEY, value INTEGER NOT NULL);
    INSERT OR IGNORE INTO local_update_clock (id, value) VALUES (1, 0);
`;

/** SQLite triggers assign a local sequence in the same statement as the canonical write. */
export function localUpdateTriggers(table: string, columns: string[]): string {
    const stamp = `
        UPDATE local_update_clock SET value = value + 1 WHERE id = 1;
        UPDATE ${table} SET localUpdatedAt = (SELECT value FROM local_update_clock WHERE id = 1)
        WHERE id = NEW.id;`;
    return `
        CREATE TRIGGER IF NOT EXISTS ${table}_local_insert AFTER INSERT ON ${table}
        BEGIN ${stamp} END;
        CREATE TRIGGER IF NOT EXISTS ${table}_local_update AFTER UPDATE OF ${columns.join(', ')} ON ${table}
        WHEN ${columns.map((column) => `OLD.${column} IS NOT NEW.${column}`).join(' OR ')}
        BEGIN ${stamp} END;
    `;
}

/** Preserve the locally assigned sequence on no-op updates; never bind caller metadata. */
export function localUpsert(columns: string[]): string {
    return `ON CONFLICT(id) DO UPDATE SET ${columns
        .filter((column) => column !== 'id')
        .map((column) => `${column} = excluded.${column}`)
        .join(', ')}`;
}
