import {
    exportPresetToKei,
    presetFileExtension,
    presetFileMimeType,
    readPresetFile,
    writePresetFile,
    type PresetFileExport
} from '$lib/porters/preset';
import { importPresetPackage as importPresetPackageToStore } from '$lib/stores';
import type { Preset } from '$lib/services';
import { downloadBytes, sanitizeFileName } from '$lib/utils/file';

export async function importPresetFile(
    file: File,
    options: { select?: boolean } = {}
): Promise<Preset> {
    const pkg = await readPresetFile(file);
    return importPresetPackageToStore(pkg, { select: options.select });
}

export async function exportPresetFile(presetId: string, request: PresetFileExport): Promise<void> {
    const pkg = await exportPresetToKei(presetId);
    const bytes = await writePresetFile(pkg, request);
    downloadBytes(
        bytes,
        `${sanitizeFileName(pkg.preset.name || 'preset')}.${presetFileExtension(request)}`,
        presetFileMimeType(request)
    );
}
