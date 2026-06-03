import { clock } from '$lib/utils/clock';
import { canAccessUserScope, getSessionScope } from '../session';
import { localDB, type PresetRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { buffer } from './record_buffer';
import {
    cascadeDeleteChildren,
    getCascadeTables,
    cleanupCascadeAssets,
    type CascadeResult
} from './cascade';
import type { LLMModelConfig, LLMParameters, LLMRole, LLMType } from '$lib/types/models/llm';
import type { EntityListConfig } from '$lib/types/refs';

// ─── Domain Types ──────────────────────────────────────────────────────

export type PromptBlockFields =
    | { name: string; type: 'text'; role: LLMRole; content: string }
    | { name: string; type: 'character'; role: LLMRole; format?: string }
    | { name: string; type: 'persona'; role: LLMRole; format?: string }
    | {
          name: string;
          type: 'lorebook';
          minDepth?: number;
          maxDepth?: number;
          reverseOrder?: boolean;
          format?: string;
      }
    | { name: string; type: 'memory'; role: LLMRole; format?: string }
    | { name: string; type: 'characterNote'; role: LLMRole; format?: string }
    | { name: string; type: 'chatNote'; role: LLMRole; format?: string }
    | { name: string; type: 'history'; start?: number; end?: number; format?: string };

export type PromptBlock = PromptBlockFields & {
    id: string;
    sortOrder: string;
    enabled: boolean;
};

export type PresetCustomToggleFields =
    | { key?: string; label?: string; type: 'group' | 'groupEnd' | 'caption' | 'divider' }
    | { key: string; label: string; type: 'checkbox' }
    | { key: string; label: string; type: 'select'; options: string[] }
    | { key: string; label: string; type: 'text' | 'textarea' };

export type PresetCustomToggle = PresetCustomToggleFields & {
    id: string;
    sortOrder: string;
};

export interface PresetContent {
    name: string;
    description: string;
    models: Partial<Record<LLMType, LLMModelConfig>>;
    parameters: Partial<Record<LLMType, LLMParameters>>;
    promptBlocks: Record<string, PromptBlock>;
    maxResponse: number;
    maxContext: number;
    lorebookRatio: number;
    memoryRatio: number;
    lorebookScanDepth: number;
    defaultVariables: Record<string, string>;
    globalVariables: Record<string, string>;
    customToggles: Record<string, PresetCustomToggle>;
}

export interface PresetRefs {
    scripts: EntityListConfig;
}

export interface PresetFields extends PresetContent, PresetRefs {}

export interface Preset extends PresetFields {
    id: string;
}

// ─── Defaults ──────────────────────────────────────────────────────────

export const defaultPresetFields: PresetFields = {
    name: 'New Preset',
    description: '',
    models: {
        chat: { id: 'openai::gpt-5.4', provider: 'openai' },
        aux: { id: 'openai::gpt-5.4', provider: 'openai' }
    },
    parameters: {
        chat: {
            temperature: 1,
            top_p: 0.9
        }
    },
    promptBlocks: {},
    maxResponse: 6000,
    maxContext: 60000,
    lorebookRatio: 0.2,
    memoryRatio: 0.2,
    lorebookScanDepth: 5,
    defaultVariables: {},
    globalVariables: {},
    customToggles: {},
    scripts: { refs: {}, folders: {} }
};

// ─── Helpers ───────────────────────────────────────────────────────────

function parseFields(record: PresetRecord): PresetFields {
    return deepMerge(defaultPresetFields, record.data as DeepPartial<PresetFields>);
}

// ─── Service ───────────────────────────────────────────────────────────

export class PresetService {
    static async list(): Promise<Preset[]> {
        await buffer.flushTable('presets');
        const records = await localDB.getAll<PresetRecord>('presets', getSessionScope('user'));

        return records.map((record) => ({ ...parseFields(record), id: record.id }));
    }

    static async get(id: string): Promise<Preset | null> {
        const record = await buffer.get<PresetRecord>('presets', id);
        if (!record || record.isDeleted || !canAccessUserScope(record)) return null;

        return { ...parseFields(record), id: record.id };
    }

    static async create(fields: DeepPartial<PresetFields> = {}): Promise<Preset> {
        const resolved: PresetFields = deepMerge(defaultPresetFields, fields);

        const scope = getSessionScope('user');
        const id = generateId();
        const now = clock.now();

        try {
            const record: PresetRecord = {
                id,
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
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
        if (!record || record.isDeleted || !canAccessUserScope(record)) {
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
        const record = await buffer.get<PresetRecord>('presets', id);
        if (!record || record.isDeleted || !canAccessUserScope(record)) {
            throw new AppError('NOT_FOUND', `Preset not found: ${id}`);
        }

        try {
            const cascadeTables = getCascadeTables('presets');
            await Promise.all(
                (['presets', ...cascadeTables] as const).map((t) => buffer.flushTable(t))
            );

            buffer.drop('presets', id);
            const result = await localDB.transaction(
                ['presets', ...cascadeTables],
                'rw',
                async (): Promise<CascadeResult> => {
                    const cascadeResult = await cascadeDeleteChildren('presets', id);
                    await localDB.softDeleteRecord('presets', id);
                    return cascadeResult;
                }
            );

            await cleanupCascadeAssets(result);
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

    // ─── Custom Toggle CRUD ───────────────────────────────────────────

    static async createCustomToggle(
        presetId: string,
        fields: DeepPartial<PresetCustomToggleFields> & { sortOrder: string }
    ): Promise<{ toggleId: string; preset: Preset }> {
        const toggleId = generateId();
        const preset = await this.update(presetId, {
            customToggles: {
                [toggleId]: {
                    ...fields,
                    id: toggleId
                }
            }
        });

        return { toggleId, preset };
    }

    static async updateCustomToggle(
        presetId: string,
        toggleId: string,
        changes: DeepPartial<PresetCustomToggle>
    ): Promise<Preset> {
        return this.update(presetId, {
            customToggles: {
                [toggleId]: changes
            }
        });
    }

    static async deleteCustomToggle(presetId: string, toggleId: string): Promise<Preset> {
        return this.update(presetId, {
            customToggles: {
                [toggleId]: undefined
            }
        });
    }
}
