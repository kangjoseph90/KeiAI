import { PresetService } from '$lib/services';
import { AppError } from '$lib/types/errors';
import type { KeiPresetPackageV1 } from './types';

export async function exportPresetPackage(presetId: string): Promise<KeiPresetPackageV1> {
    const preset = await PresetService.get(presetId);
    if (!preset) {
        throw new AppError('NOT_FOUND', `Preset not found: ${presetId}`);
    }

    const portablePreset = {
        name: preset.name,
        description: preset.description,
        models: structuredClone(preset.models),
        parameters: structuredClone(preset.parameters),
        chatWorkflow: structuredClone(preset.chatWorkflow),
        commands: structuredClone(preset.commands),
        defaultVariables: { ...preset.defaultVariables },
        toggles: structuredClone(preset.toggles),
        scripts: structuredClone(preset.scripts)
    };

    return {
        version: 1,
        kind: 'keiai.preset',
        preset: portablePreset
    };
}
