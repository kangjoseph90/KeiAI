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
import type { LLMModelConfig, LLMParameters, LLMType } from '$lib/types/models/llm';
import type { EntityListConfig } from '$lib/types/refs';
import type { WorkflowDefinition } from '$lib/workflow/types';
import { normalizeWorkflow } from '$lib/workflow/normalization';
import type { TogglePanel } from '$lib/types/toggle';
import { defaultScriptFields, hydrateOwnedItems, type Script } from './resource';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface PresetFields {
    name: string;
    description: string;
    models: Partial<Record<LLMType, LLMModelConfig>>;
    parameters: Partial<Record<LLMType, LLMParameters>>;
    chatWorkflow: WorkflowDefinition;
    defaultVariables: Record<string, string>;
    toggles: TogglePanel;
    scripts: EntityListConfig<Script>;
}

export interface Preset extends PresetFields {
    id: string;
}

// ─── Defaults ──────────────────────────────────────────────────────────

export const defaultPresetFields: PresetFields = {
    name: 'New Preset',
    description: '',
    models: {
        chat: { id: 'openai::gpt-5.6', provider: 'openai' },
        aux: { id: 'openai::gpt-5.6', provider: 'openai' }
    },
    parameters: {
        chat: {
            temperature: 1,
            top_p: 0.9
        }
    },
    chatWorkflow: { nodes: {} },
    defaultVariables: {},
    toggles: { refs: {}, folders: {} },
    scripts: { refs: {}, folders: {} }
};

// ─── Helpers ───────────────────────────────────────────────────────────

function parseFields(record: PresetRecord): PresetFields {
    const fields = deepMerge(defaultPresetFields, record.data as DeepPartial<PresetFields>);
    fields.chatWorkflow = normalizeWorkflow(fields.chatWorkflow);
    fields.scripts.refs = hydrateOwnedItems(fields.scripts.refs, defaultScriptFields);
    return fields;
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
}
