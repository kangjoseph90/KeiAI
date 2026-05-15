import { PresetService, ScriptService } from '$lib/services';
import { AppError } from '$lib/types/errors';
import type { KeiPresetPackageV1 } from './types';
import { remapEntityList } from '../utils';

function assertPackage(pkg: KeiPresetPackageV1): void {
    if (pkg.version !== 1 || pkg.kind !== 'keiai.preset') {
        throw new AppError('INVALID_INPUT', 'Unsupported preset package');
    }
}

export async function importPresetFromKei(pkg: KeiPresetPackageV1): Promise<string> {
    assertPackage(pkg);

    const preset = await PresetService.create({
        name: pkg.preset.name,
        description: pkg.preset.description,
        chatModel: { ...pkg.preset.chatModel },
        auxModel: { ...pkg.preset.auxModel },
        promptBlocks: structuredClone(pkg.preset.promptBlocks),
        maxResponse: pkg.preset.maxResponse,
        maxContext: pkg.preset.maxContext,
        lorebookRatio: pkg.preset.lorebookRatio,
        memoryRatio: pkg.preset.memoryRatio,
        lorebookScanDepth: pkg.preset.lorebookScanDepth,
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
