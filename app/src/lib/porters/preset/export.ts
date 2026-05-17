import { PresetService, ScriptService } from '$lib/services';
import { AppError } from '$lib/types/errors';
import type { KeiPresetPackageV1, KeiPresetPayload } from './types';
import { createPortableIdMap, exportEntityList } from '../utils';

export async function exportPresetToKei(presetId: string): Promise<KeiPresetPackageV1> {
    const preset = await PresetService.get(presetId);
    if (!preset) {
        throw new AppError('NOT_FOUND', `Preset not found: ${presetId}`);
    }

    const scripts = await ScriptService.listByOwner(presetId);

    const scriptMap = createPortableIdMap(
        scripts.map((item) => item.id),
        'script'
    );

    const portablePreset: KeiPresetPayload = {
        name: preset.name,
        description: preset.description,
        chatModel: { ...preset.chatModel },
        auxModel: { ...preset.auxModel },
        promptBlocks: structuredClone(preset.promptBlocks),
        maxResponse: preset.maxResponse,
        maxContext: preset.maxContext,
        lorebookRatio: preset.lorebookRatio,
        memoryRatio: preset.memoryRatio,
        lorebookScanDepth: preset.lorebookScanDepth,
        defaultVariables: { ...preset.defaultVariables },
        globalVariables: { ...preset.globalVariables },
        customToggles: structuredClone(preset.customToggles),
        scripts: exportEntityList(preset.scripts, scriptMap, 'script_folder')
    };

    return {
        version: 1,
        kind: 'keiai.preset',
        preset: portablePreset,
        scripts: scripts.map(
            ({ id, ownerId: _ownerId, scopeType: _scopeType, scopeId: _scopeId, ...fields }) => ({
                ...fields,
                id: scriptMap[id]
            })
        )
    };
}
