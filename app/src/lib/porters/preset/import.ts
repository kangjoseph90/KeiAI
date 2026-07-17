import { PresetService, ScriptService } from '$lib/services';
import { AppError } from '$lib/types/errors';
import type { KeiPresetPackageV1 } from './types';
import { remapEntityList } from '../utils';

function assertPackage(pkg: KeiPresetPackageV1): void {
    if (pkg.version !== 1 || pkg.kind !== 'keiai.preset') {
        throw new AppError('INVALID_INPUT', 'Unsupported preset package');
    }
}

export async function importPresetPackage(pkg: KeiPresetPackageV1): Promise<string> {
    assertPackage(pkg);

    const preset = await PresetService.create({
        name: pkg.preset.name,
        description: pkg.preset.description,
        models: structuredClone(pkg.preset.models),
        parameters: structuredClone(pkg.preset.parameters),
        chatWorkflow: structuredClone(pkg.preset.chatWorkflow),
        defaultVariables: { ...pkg.preset.defaultVariables },
        toggles: structuredClone(pkg.preset.toggles),
        scripts: { refs: {}, folders: {} }
    });

    const scriptMap: Record<string, string> = {};
    for (const { id, ...fields } of pkg.scripts) {
        const script = await ScriptService.create(preset.id, fields);
        scriptMap[id] = script.id;
    }

    await PresetService.update(preset.id, {
        scripts: remapEntityList(pkg.preset.scripts, scriptMap)
    });

    return preset.id;
}
