import { clock } from '$lib/utils/clock';
import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '../session';
import { localDB, type CharJSRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { encryptedWriteQueue } from './write_queue';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface CharJSFields {
    name: string;
    code: string;
    enabled: boolean;
}

export interface CharJS extends CharJSFields {
    id: string;
    ownerId: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultCharJSFields: CharJSFields = {
    name: 'New Script',
    code: '',
    enabled: true
};

// ─── Helpers ──────────────────────────────────────────────────────────

function decryptFields(masterKey: CryptoKey, record: CharJSRecord): Promise<CharJSFields> {
    return decrypt(masterKey, {
        ciphertext: record.encryptedData,
        iv: record.encryptedDataIV
    })
        .then((dec) => deepMerge(defaultCharJSFields, JSON.parse(dec)))
        .catch((error) => {
            throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt charjs script', error);
        });
}

// ─── Service ──────────────────────────────────────────────────────────

export class CharJSService {
    /** List charjs scripts owned by a specific parent (character, module) */
    static async listByOwner(ownerId: string): Promise<CharJS[]> {
        await encryptedWriteQueue.flushTable('charjs');
        const { masterKey } = getActiveSession();
        const records = await localDB.getByIndex<CharJSRecord>(
            'charjs',
            'ownerId',
            ownerId,
            Number.MAX_SAFE_INTEGER
        );

        return Promise.all(
            records.map(async (record) => {
                const fields = await decryptFields(masterKey, record);
                return {
                    id: record.id,
                    ownerId: record.ownerId,
                    ...fields
                };
            })
        );
    }

    static async get(id: string): Promise<CharJS | null> {
        const { masterKey } = getActiveSession();
        const queued = encryptedWriteQueue.peek<CharJSFields>('charjs', id);
        if (queued) {
            const record = await localDB.getRecord<CharJSRecord>('charjs', id);
            if (!record || record.isDeleted) return null;
            return {
                id,
                ownerId: record.ownerId,
                ...deepMerge(defaultCharJSFields, queued)
            };
        }

        const record = await localDB.getRecord<CharJSRecord>('charjs', id);
        if (!record || record.isDeleted) return null;

        const fields = await decryptFields(masterKey, record);
        return {
            id: record.id,
            ownerId: record.ownerId,
            ...fields
        };
    }

    static async create(ownerId: string, fields: DeepPartial<CharJSFields> = {}): Promise<CharJS> {
        const resolved: CharJSFields = deepMerge(defaultCharJSFields, fields);

        const { masterKey, userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        try {
            const enc = await encrypt(masterKey, JSON.stringify(resolved));
            const newRecord: CharJSRecord = {
                id,
                userId,
                ownerId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                encryptedData: enc.ciphertext,
                encryptedDataIV: enc.iv
            };
            await localDB.putRecord<CharJSRecord>('charjs', newRecord);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create charjs script', error);
        }

        return { id, ownerId, ...resolved };
    }

    static async update(id: string, changes: DeepPartial<CharJSFields>): Promise<CharJS> {
        const { masterKey } = getActiveSession();
        const queued = encryptedWriteQueue.peek<CharJSFields>('charjs', id);
        const record = await localDB.getRecord<CharJSRecord>('charjs', id);
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', `CharJS script not found: ${id}`);
        }

        try {
            const current = queued
                ? deepMerge(defaultCharJSFields, queued)
                : await decryptFields(masterKey, record);
            const updated: CharJSFields = deepMerge(current, changes);

            encryptedWriteQueue.upsert<CharJSFields, CharJSRecord>({
                tableName: 'charjs',
                id,
                userId: record.userId,
                createdAt: record.createdAt,
                nextFields: updated,
                mergeFields: (queuedCurrent, next) => deepMerge(queuedCurrent, next),
                toRecord: ({
                    id: recordId,
                    userId: recordUserId,
                    createdAt,
                    updatedAt,
                    encryptedData,
                    encryptedDataIV
                }) => ({
                    id: recordId,
                    userId: recordUserId,
                    ownerId: record.ownerId,
                    createdAt,
                    updatedAt,
                    isDeleted: false,
                    encryptedData,
                    encryptedDataIV
                })
            });

            return { id, ownerId: record.ownerId, ...updated };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update charjs script', error);
        }
    }

    static delete(id: string): Promise<void> {
        try {
            encryptedWriteQueue.drop('charjs', id);
            return localDB.softDeleteRecord('charjs', id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete charjs script', error);
        }
    }

    /**
     * Subscribes to local database changes for CharJS records, allowing runtime
     * environments or UI components to automatically invalidate cache instantly.
     */
    static onChange(callback: (id: string) => void): () => void {
        return localDB.subscribeWriteEvents((events) => {
            for (const event of events) {
                if (event.tableName === 'charjs') {
                    for (const id of event.ids) {
                        callback(id);
                    }
                }
            }
        });
    }
}
