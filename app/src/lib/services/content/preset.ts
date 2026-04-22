import { clock } from '$lib/utils/clock';
import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '../session';
import { localDB, type PresetRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { encryptedWriteQueue } from './write_queue';
import type { LLMModelConfig } from '$lib/types/models/llm';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface PresetFields {
    name: string;
    description: string;
    chatModel: LLMModelConfig;
    auxModel: LLMModelConfig;
    templateOrder: PromptTemplateEntry[];
    maxResponse: number;
    maxContext: number;
}

export type PromptTemplateEntry =
    | { name: string; type: 'instruction'; role: 'system' | 'user' | 'assistant'; content: string }
    | { name: string; type: 'description' }
    | { name: string; type: 'persona' }
    | { name: string; type: 'lorebook' }
    | { name: string; type: 'history'; start: number; end?: number };

export interface Preset extends PresetFields {
    id: string;
}

// ─── Defaults ──────────────────────────────────────────────────────────

export const defaultPresetFields: PresetFields = {
    name: 'New Preset',
    description: '',
    chatModel: { id: 'openai::gpt-5.4', provider: 'openai', parameters: {} },
    auxModel: { id: 'openai::gpt-5.4', provider: 'openai', parameters: {} },
    templateOrder: [
        { name: 'System instruction', type: 'instruction', role: 'system', content: '' },
        { name: 'Character description', type: 'description' },
        { name: 'User persona', type: 'persona' },
        { name: 'Lorebook', type: 'lorebook' },
        { name: 'Early history', type: 'history', start: -10 },
        { name: 'Additional instruction', type: 'instruction', role: 'system', content: '' }
    ],
    maxResponse: 600,
    maxContext: 4096
};

// ─── Helpers ───────────────────────────────────────────────────────────

function decryptFields(masterKey: CryptoKey, record: PresetRecord): Promise<PresetFields> {
    return decrypt(masterKey, {
        ciphertext: record.encryptedData,
        iv: record.encryptedDataIV
    })
        .then((dec) => deepMerge(defaultPresetFields, JSON.parse(dec)))
        .catch((error) => {
            throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt preset', error);
        });
}

// ─── Service ───────────────────────────────────────────────────────────

export class PresetService {
    static async list(): Promise<Preset[]> {
        await encryptedWriteQueue.flushTable('presets');
        const { masterKey, userId } = getActiveSession();
        const records = await localDB.getAll<PresetRecord>('presets', userId);

        return Promise.all(
            records.map(async (record) => {
                const fields = await decryptFields(masterKey, record);
                return { id: record.id, ...fields };
            })
        );
    }

    static async get(id: string): Promise<Preset | null> {
        const { masterKey } = getActiveSession();
        const queued = encryptedWriteQueue.peek<PresetFields>('presets', id);
        if (queued) {
            const record = await localDB.getRecord<PresetRecord>('presets', id);
            if (!record || record.isDeleted) return null;
            return {
                id,
                ...deepMerge(defaultPresetFields, queued)
            };
        }

        const record = await localDB.getRecord<PresetRecord>('presets', id);
        if (!record || record.isDeleted) return null;

        const fields = await decryptFields(masterKey, record);
        return { id: record.id, ...fields };
    }

    static async create(fields: DeepPartial<PresetFields> = {}): Promise<Preset> {
        const resolved: PresetFields = deepMerge(defaultPresetFields, fields);

        const { masterKey, userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        try {
            const enc = await encrypt(masterKey, JSON.stringify(resolved));
            const record: PresetRecord = {
                id,
                userId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                encryptedData: enc.ciphertext,
                encryptedDataIV: enc.iv
            };
            await localDB.putRecord<PresetRecord>('presets', record);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create preset', error);
        }

        return { id, ...resolved };
    }

    static async update(id: string, changes: DeepPartial<PresetFields>): Promise<Preset> {
        const { masterKey } = getActiveSession();
        const queued = encryptedWriteQueue.peek<PresetFields>('presets', id);
        const record = await localDB.getRecord<PresetRecord>('presets', id);
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', `Preset not found: ${id}`);
        }

        try {
            const current = queued
                ? deepMerge(defaultPresetFields, queued)
                : await decryptFields(masterKey, record);
            const updated: PresetFields = deepMerge(current, changes);

            encryptedWriteQueue.upsert<PresetFields, PresetRecord>({
                tableName: 'presets',
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
                    createdAt,
                    updatedAt,
                    isDeleted: false,
                    encryptedData,
                    encryptedDataIV
                })
            });

            return { id, ...updated };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update preset', error);
        }
    }

    static async delete(id: string): Promise<void> {
        try {
            encryptedWriteQueue.drop('presets', id);
            await localDB.softDeleteRecord('presets', id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete preset', error);
        }
    }
}
