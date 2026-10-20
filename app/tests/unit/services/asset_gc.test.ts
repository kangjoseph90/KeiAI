import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('asset garbage collection', () => {
    it('continues past a full batch of failed deletions and terminates', () => {
        const source = readFileSync(
            resolve(process.cwd(), '../pocketbase/pb_hooks/main.pb.js'),
            'utf8'
        );
        const callback = source.match(
            /cronAdd\("asset-gc", "0 \* \* \* \*", \(\) => \{[\s\S]*?\n\}\);/
        )?.[0];
        expect(callback).toBeDefined();

        const rows = Array.from({ length: 400 }, (_, index) => ({
            id: String(index).padStart(15, '0'),
            hash: index.toString(16).padStart(64, '0')
        }));
        const deleted = new Set<string>();
        let queryCount = 0;
        let deletionAttempts = 0;
        const maxQueries = 4;
        let runGc: (() => void) | undefined;
        const context = {
            cronAdd: (_name: string, _schedule: string, handler: () => void) => {
                runGc = handler;
            },
            __hooks: '/hooks',
            require: () => ({
                hasAssetUsage: () => false,
                deleteAssetBytes: () => ++deletionAttempts > 200
            }),
            DynamicModel: function (this: object) {
                Object.assign(this, {});
            },
            arrayOf: () => [],
            $app: {
                db: () => ({
                    newQuery: () => ({
                        bind: (bindings: { afterId: string; limit: number }) => ({
                            all: (target: { push: (row: unknown) => void }) => {
                                queryCount++;
                                if (queryCount > maxQueries) {
                                    throw new Error('GC did not advance through failed rows');
                                }
                                rows.filter(
                                    (row) => row.id > bindings.afterId && !deleted.has(row.id)
                                )
                                    .slice(0, bindings.limit)
                                    .forEach((row) => target.push(row));
                            }
                        })
                    })
                }),
                findRecordById: (_collection: string, id: string) => ({ id }),
                delete: (record: { id: string }) => deleted.add(record.id)
            }
        };

        runInNewContext(callback!, context);
        runGc!();

        expect(queryCount).toBe(3);
        expect(deletionAttempts).toBe(400);
        expect(deleted.size).toBe(200);
        expect(deleted.has('000000000000199')).toBe(false);
        expect(deleted.has('000000000000200')).toBe(true);
        expect(deleted.has('000000000000399')).toBe(true);

        // A new cron invocation starts its keyset over and retries failed rows.
        queryCount = 0;
        runGc!();
        expect(queryCount).toBe(2);
        expect(deletionAttempts).toBe(600);
        expect(deleted.size).toBe(400);
    });
});
