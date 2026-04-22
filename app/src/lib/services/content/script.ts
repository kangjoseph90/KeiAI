import { clock } from '$lib/utils/clock';
import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '../session';
import { localDB, type ScriptRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { encryptedWriteQueue } from './write_queue';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface ScriptFields {
    type: 'regex';
    name: string;
    regex: string;
    replacement: string;
    phase: 'input' | 'request' | 'output' | 'display';
    advanced: boolean; // use advanced settings
    flag: string;
    order: number;
    repeat: number;
    enabled: boolean;
}

export interface Script extends ScriptFields {
    id: string;
    ownerId: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultScriptFields: ScriptFields = {
    type: 'regex',
    name: 'New Script',
    regex: '',
    replacement: '',
    phase: 'display',
    advanced: false,
    flag: 'g',
    order: 100,
    repeat: 1,
    enabled: true
};

// ─── Helpers ──────────────────────────────────────────────────────────

function decryptFields(masterKey: CryptoKey, record: ScriptRecord): Promise<ScriptFields> {
    return decrypt(masterKey, {
        ciphertext: record.encryptedData,
        iv: record.encryptedDataIV
    })
        .then((dec) => deepMerge(defaultScriptFields, JSON.parse(dec)))
        .catch((error) => {
            throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt script', error);
        });
}

// ─── Service ──────────────────────────────────────────────────────────

export class ScriptService {
    /** List scripts owned by a specific parent (character, module) */
    static async listByOwner(ownerId: string): Promise<Script[]> {
        await encryptedWriteQueue.flushTable('scripts');
        const { masterKey } = getActiveSession();
        const records = await localDB.getByIndex<ScriptRecord>(
            'scripts',
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

    static async get(id: string): Promise<Script | null> {
        const { masterKey } = getActiveSession();
        const queued = encryptedWriteQueue.peek<ScriptFields>('scripts', id);
        if (queued) {
            const record = await localDB.getRecord<ScriptRecord>('scripts', id);
            if (!record || record.isDeleted) return null;
            return {
                id,
                ownerId: record.ownerId,
                ...deepMerge(defaultScriptFields, queued)
            };
        }

        const record = await localDB.getRecord<ScriptRecord>('scripts', id);
        if (!record || record.isDeleted) return null;

        const fields = await decryptFields(masterKey, record);
        return {
            id: record.id,
            ownerId: record.ownerId,
            ...fields
        };
    }

    static async create(ownerId: string, fields: DeepPartial<ScriptFields> = {}): Promise<Script> {
        const resolved: ScriptFields = deepMerge(defaultScriptFields, fields);

        const { masterKey, userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        try {
            const enc = await encrypt(masterKey, JSON.stringify(resolved));
            const newRecord: ScriptRecord = {
                id,
                userId,
                ownerId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                encryptedData: enc.ciphertext,
                encryptedDataIV: enc.iv
            };
            await localDB.putRecord<ScriptRecord>('scripts', newRecord);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create script', error);
        }

        return { id, ownerId, ...resolved };
    }

    static async update(id: string, changes: DeepPartial<ScriptFields>): Promise<Script> {
        const { masterKey } = getActiveSession();
        const queued = encryptedWriteQueue.peek<ScriptFields>('scripts', id);
        const record = await localDB.getRecord<ScriptRecord>('scripts', id);
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', `Script not found: ${id}`);
        }

        try {
            const current = queued
                ? deepMerge(defaultScriptFields, queued)
                : await decryptFields(masterKey, record);
            const updated: ScriptFields = deepMerge(current, changes);

            encryptedWriteQueue.upsert<ScriptFields, ScriptRecord>({
                tableName: 'scripts',
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
            throw new AppError('DB_WRITE_FAILED', 'Failed to update script', error);
        }
    }

    static async delete(id: string): Promise<void> {
        try {
            encryptedWriteQueue.drop('scripts', id);
            await localDB.softDeleteRecord('scripts', id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete script', error);
        }
    }
}
