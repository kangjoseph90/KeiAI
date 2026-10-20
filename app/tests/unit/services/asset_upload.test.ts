// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';

const bytes = new Uint8Array([1, 2, 3, 4]);
const hash = createHash('sha256').update(bytes).digest('hex');
const oldCreatedAt = Date.now() - 2 * 60 * 60 * 1000;
const main = readFileSync(resolve(process.cwd(), '../pocketbase/pb_hooks/main.pb.js'), 'utf8');

function setup(options: { initialLookupMiss?: boolean; removeBeforeRenewal?: boolean } = {}) {
    const sql = new DatabaseSync(':memory:');
    sql.exec(`
        CREATE TABLE asset_catalog (id TEXT PRIMARY KEY, hash TEXT UNIQUE, createdAt INTEGER,
            recoveryProtected INTEGER, size INTEGER);
        CREATE TABLE asset_usage (hash TEXT);
    `);
    sql.prepare('INSERT INTO asset_catalog VALUES (?, ?, ?, 0, ?)').run(
        'catalogasset001',
        hash,
        oldCreatedAt,
        bytes.length
    );
    let initialLookup = true;
    let removeRow = options.removeBeforeRenewal ?? false;
    let deletedBytes = 0;
    let afterGcSelect: (() => void) | undefined;

    const asRecord = (row: Record<string, unknown>) => {
        const record = {
            id: String(row.id),
            hash: String(row.hash),
            createdAt: Number(row.createdAt),
            set(name: string, value: unknown) {
                if (name === 'createdAt') record.createdAt = Number(value);
            }
        };
        return record;
    };
    const app = {
        findFirstRecordByData: (_collection: string, _field: string, value: string) => {
            if (options.initialLookupMiss && initialLookup) {
                initialLookup = false;
                throw new Error('no rows');
            }
            const row = sql.prepare('SELECT * FROM asset_catalog WHERE hash = ?').get(value) as
                | Record<string, unknown>
                | undefined;
            if (!row) throw new Error('no rows');
            return asRecord(row);
        },
        runInTransaction: (callback: (txApp: unknown) => void) => {
            if (removeRow) {
                sql.prepare('DELETE FROM asset_catalog WHERE hash = ?').run(hash);
                removeRow = false;
            }
            sql.exec('BEGIN');
            try {
                callback(app);
                sql.exec('COMMIT');
            } catch (error) {
                sql.exec('ROLLBACK');
                throw error;
            }
        },
        save: (record: ReturnType<typeof asRecord>) => {
            const result = sql
                .prepare('UPDATE asset_catalog SET createdAt = ? WHERE id = ?')
                .run(record.createdAt, record.id);
            if (Number(result.changes) === 0) throw new Error('record not found');
        },
        db: () => ({
            newQuery: (query: string) => {
                const statement = sql.prepare(query.replace(/\{:(\w+)\}/g, ':$1'));
                return {
                    bind: (bindings: Record<string, number | string>) => ({
                        all: (target: unknown[]) => {
                            target.push(...statement.all(bindings));
                            if (query.includes('SELECT c.id, c.hash FROM asset_catalog c')) {
                                const callback = afterGcSelect;
                                afterGcSelect = undefined;
                                callback?.();
                            }
                        }
                    })
                };
            }
        }),
        findRecordById: (_collection: string, id: string) => {
            const row = sql.prepare('SELECT * FROM asset_catalog WHERE id = ?').get(id) as
                | Record<string, unknown>
                | undefined;
            if (!row) throw new Error('record not found');
            return asRecord(row);
        },
        delete: (record: ReturnType<typeof asRecord>) => {
            sql.prepare('DELETE FROM asset_catalog WHERE id = ?').run(record.id);
        }
    };

    const module = { exports: {} as Record<string, unknown> };
    runInNewContext(
        readFileSync(resolve(process.cwd(), '../pocketbase/pb_hooks/keiai.js'), 'utf8'),
        {
            module,
            $os: { getenv: () => '' },
            $app: app,
            arrayOf: () => [],
            DynamicModel: function () {}
        }
    );
    const helpers = {
        ...module.exports,
        checkRate: () => true,
        getAuthRecord: () => ({ id: 'audituser000001', getString: () => 'audit' }),
        rejectDisallowedUsername: () => undefined,
        sha256Bytes: () => hash,
        getMultiRoomUploadOwner: () => ({ status: 200, ownerUserId: 'audituser000001' }),
        hasAssetUsage: () => false,
        deleteAssetBytes: () => {
            deletedBytes++;
            return true;
        }
    };
    const routes = new Map<string, (event: unknown) => unknown>();
    const context = {
        __hooks: '/hooks',
        require: () => helpers,
        $app: app,
        toBytes: () => bytes,
        arrayOf: () => [],
        DynamicModel: function () {},
        routerAdd: (_method: string, path: string, callback: (event: unknown) => unknown) => {
            routes.set(path, callback);
        }
    };
    const route = (path: string) => {
        const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const source = main.match(
            new RegExp(`routerAdd\\("PUT", "${escaped}", \\(e\\) => \\{[\\s\\S]*?\\n\\}\\);`)
        )?.[0];
        if (!source) throw new Error(`Upload route not found: ${path}`);
        runInNewContext(source, context);
        const callback = routes.get(path);
        if (!callback) throw new Error(`Upload route not registered: ${path}`);
        return callback;
    };
    const gc = main.match(/cronAdd\("asset-gc", "0 \* \* \* \*", \(\) => \{[\s\S]*?\n\}\);/)?.[0];
    if (!gc) throw new Error('Asset GC callback not found');
    let runGc: (() => void) | undefined;
    runInNewContext(gc, {
        ...context,
        cronAdd: (_name: string, _schedule: string, callback: () => void) => (runGc = callback)
    });

    return {
        sql,
        route,
        runGc: () => runGc?.(),
        set afterGcSelect(callback: () => void) {
            afterGcSelect = callback;
        },
        get deletedBytes() {
            return deletedBytes;
        }
    };
}

function event(roomId?: string) {
    return {
        auth: { id: 'audituser000001', getString: () => 'audit' },
        realIP: () => '127.0.0.1',
        request: {
            body: bytes,
            pathValue: (name: string) => (name === 'roomId' ? roomId : hash)
        },
        json: (status: number, body: unknown) => ({ status, body })
    };
}

describe('asset upload garbage-collection grace', () => {
    let sql: DatabaseSync | undefined;
    afterEach(() => {
        sql?.close();
        sql = undefined;
    });

    it('renews personal and room deduplicated assets so the real GC query retains them', () => {
        const h = setup();
        sql = h.sql;
        for (const [path, roomId] of [
            ['/api/assets/{hash}', undefined],
            ['/api/multi-rooms/{roomId}/assets/{hash}', 'room-1']
        ] as const) {
            expect(h.route(path)(event(roomId))).toMatchObject({
                status: 200,
                body: { status: 'exists', hash }
            });
        }
        expect(
            Number(sql.prepare('SELECT createdAt FROM asset_catalog').get()!.createdAt)
        ).toBeGreaterThan(oldCreatedAt);

        h.runGc();
        expect(sql.prepare('SELECT id FROM asset_catalog').get()).toBeDefined();
        expect(h.deletedBytes).toBe(0);
    });

    it('renews a row found by the transaction recheck and refuses to recreate a row deleted first', () => {
        const h = setup({ initialLookupMiss: true });
        sql = h.sql;
        expect(h.route('/api/assets/{hash}')(event())).toMatchObject({
            status: 200,
            body: { status: 'exists', hash }
        });
        expect(
            Number(sql.prepare('SELECT createdAt FROM asset_catalog').get()!.createdAt)
        ).toBeGreaterThan(oldCreatedAt);
        h.sql.close();
        sql = undefined;

        const raced = setup({ removeBeforeRenewal: true });
        sql = raced.sql;
        expect(raced.route('/api/assets/{hash}')(event())).toMatchObject({ status: 500 });
        expect(sql.prepare('SELECT id FROM asset_catalog').get()).toBeUndefined();
    });

    it('skips a stale GC candidate after a concurrent upload renews its grace', () => {
        const h = setup();
        sql = h.sql;
        let renewed = false;
        h.afterGcSelect = () => {
            expect(h.route('/api/assets/{hash}')(event())).toMatchObject({ status: 200 });
            renewed = true;
        };

        h.runGc();

        expect(renewed).toBe(true);
        expect(sql.prepare('SELECT id FROM asset_catalog').get()).toBeDefined();
        expect(h.deletedBytes).toBe(0);
    });
});
