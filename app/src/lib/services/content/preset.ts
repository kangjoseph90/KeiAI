import { clock } from '$lib/utils/clock';
import { getActiveSession, UserService } from '../user';
import { localDB, type PresetRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { buffer } from './record_buffer';
import type { LLMModelConfig, LLMRole } from '$lib/types/models/llm';

// ─── Domain Types ──────────────────────────────────────────────────────

export type PromptBlockFields =
    | { name: string; type: 'text'; role: LLMRole; content: string }
    | { name: string; type: 'character'; role: LLMRole }
    | { name: string; type: 'persona'; role: LLMRole }
    | { name: string; type: 'lorebook'; role: LLMRole }
    | { name: string; type: 'memory'; role: LLMRole }
    | { name: string; type: 'characterNote'; role: LLMRole }
    | { name: string; type: 'chatNote'; role: LLMRole }
    | { name: string; type: 'history'; start?: number; end?: number };

export type PromptBlock = PromptBlockFields & {
    id: string;
    sortOrder: string;
    enabled: boolean;
};

export interface PresetFields {
    name: string;
    description: string;
    chatModel: LLMModelConfig;
    auxModel: LLMModelConfig;
    promptBlocks: Record<string, PromptBlock>;
    maxResponse: number;
    maxContext: number;
    lorebookRatio: number;
    memoryRatio: number;
}

export interface Preset extends PresetFields {
    id: string;
}

// ─── Defaults ──────────────────────────────────────────────────────────

export const defaultPresetFields: PresetFields = {
    name: 'New Preset',
    description: '',
    chatModel: { id: 'openai::gpt-5.4', provider: 'openai', parameters: {} },
    auxModel: { id: 'openai::gpt-5.4', provider: 'openai', parameters: {} },
    promptBlocks: {},
    maxResponse: 6000,
    maxContext: 60000,
    lorebookRatio: 0.2,
    memoryRatio: 0.2
};

// ─── Helpers ───────────────────────────────────────────────────────────

function parseFields(record: PresetRecord): PresetFields {
    return deepMerge(defaultPresetFields, record.data as DeepPartial<PresetFields>);
}

// ─── Service ───────────────────────────────────────────────────────────

export class PresetService {
    static async list(): Promise<Preset[]> {
        await buffer.flushTable('presets');
        const { userId } = getActiveSession();
        const records = await localDB.getAll<PresetRecord>('presets', userId);

        return records.map((record) => ({ ...parseFields(record), id: record.id }));
    }

    static async get(id: string): Promise<Preset | null> {
        const record = await buffer.get<PresetRecord>('presets', id);
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
        const record = await buffer.get<PresetRecord>('presets', id);
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', `Preset not found: ${id}`);
        }

        try {
            const current = parseFields(record);
            const updated: PresetFields = deepMerge(current, changes);

            buffer.update<PresetRecord>({
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
            buffer.drop('presets', id);
            await localDB.softDeleteRecord('presets', id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete preset', error);
        }
    }

    // ─── Block CRUD ───────────────────────────────────────────────────

    static async createBlock(
        presetId: string,
        fields: DeepPartial<PromptBlockFields> & { sortOrder: string }
    ): Promise<{ blockId: string; preset: Preset }> {
        const blockId = generateId();
        const preset = await this.update(presetId, {
            promptBlocks: {
                [blockId]: {
                    ...fields,
                    id: blockId,
                    enabled: true
                }
            }
        });

        return { blockId, preset };
    }

    static async updateBlock(
        presetId: string,
        blockId: string,
        changes: DeepPartial<PromptBlock>
    ): Promise<Preset> {
        return this.update(presetId, {
            promptBlocks: {
                [blockId]: changes
            }
        });
    }

    static async deleteBlock(presetId: string, blockId: string): Promise<Preset> {
        return this.update(presetId, {
            promptBlocks: {
                [blockId]: undefined
            }
        });
    }
}
