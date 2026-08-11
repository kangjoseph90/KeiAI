import { PresetService } from '$lib/services';
import { AppError } from '$lib/types/errors';
import type { KeiPresetPackageV1 } from './types';
import { importEntityList } from '../utils';

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
        commands: structuredClone(pkg.preset.commands),
        defaultVariables: { ...pkg.preset.defaultVariables },
        toggles: structuredClone(pkg.preset.toggles),
        scripts: importEntityList(pkg.preset.scripts)
    });

    return preset.id;
}
