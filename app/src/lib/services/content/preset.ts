import { clock } from '$lib/utils/clock';
import { getActiveSession } from '../session';
import { localDB, type PresetRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { writeQueue } from './write_queue';
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

function parseFields(record: PresetRecord): PresetFields {
    return deepMerge(defaultPresetFields, record.data as DeepPartial<PresetFields>);
}

// ─── Service ───────────────────────────────────────────────────────────

export class PresetService {
    static async list(): Promise<Preset[]> {
        await writeQueue.flushTable('presets');
        const { userId } = getActiveSession();
        const records = await localDB.getAll<PresetRecord>('presets', userId);

        return records.map((record) => ({ ...parseFields(record), id: record.id }));
    }

    static async get(id: string): Promise<Preset | null> {
        const cached = writeQueue.peek<PresetRecord>('presets', id);
        if (cached) {
            if (cached.isDeleted) return null;
            return {
                ...parseFields(cached),
                id: cached.id
            };
        }

        const record = await localDB.getRecord<PresetRecord>('presets', id);
        if (!record || record.isDeleted) return null;

        return { ...parseFields(record), id: record.id };
    }

    static async create(fields: DeepPartial<PresetFields> = {}): Promise<Preset> {
        const resolved: PresetFields = deepMerge(defaultPresetFields, fields);

        const { userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        try {
            const record: PresetRecord = {
                id,
                userId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                data: resolved as unknown as Record<string, unknown>
            };
            await localDB.putRecord<PresetRecord>('presets', record);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create preset', error);
        }

        return { ...resolved, id };
    }

    static async update(id: string, changes: DeepPartial<PresetFields>): Promise<Preset> {
        const cached = writeQueue.peek<PresetRecord>('presets', id);
        const record = cached ?? (await localDB.getRecord<PresetRecord>('presets', id));
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', `Preset not found: ${id}`);
        }

        try {
            const current = parseFields(record);
            const updated: PresetFields = deepMerge(current, changes);

            writeQueue.update<PresetRecord>({
                tableName: 'presets',
                record: { ...record, data: updated as unknown as Record<string, unknown> },
                patch: changes as unknown as Record<string, unknown>
            });

            return { ...updated, id: record.id };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update preset', error);
        }
    }

    static async delete(id: string): Promise<void> {
        try {
            writeQueue.drop('presets', id);
            await localDB.softDeleteRecord('presets', id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete preset', error);
        }
    }
}
