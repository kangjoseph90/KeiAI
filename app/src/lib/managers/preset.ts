import {
    exportPresetPackage,
    presetFileExtension,
    presetFileMimeType,
    readPresetFile,
    writePresetFile,
    type PresetFileExport
} from '$lib/porters/preset';
import { importPresetPackage as importPresetPackageToStore } from '$lib/stores';
import { getActivePreset, updatePresetContent } from '$lib/stores/content/preset';
import type { Preset } from '$lib/services';
import { sanitizeFileName } from '$lib/utils/file';
import { appDialog } from '$lib/adapters/dialog';

export async function importPresetFile(options: { select?: boolean } = {}): Promise<Preset | null> {
    const file = await appDialog.openFile({
        title: 'Import Preset',
        filters: [
            { name: 'Preset files', extensions: ['risup', 'risupreset', 'keipreset', 'json'] }
        ]
    });
    if (!file) return null;
    const pkg = await readPresetFile(file);
    return importPresetPackageToStore(pkg, { select: options.select });
}

export async function exportPresetFile(presetId: string, request: PresetFileExport): Promise<void> {
    const pkg = await exportPresetPackage(presetId);
    const bytes = await writePresetFile(pkg, request);
    const extension = presetFileExtension(request);
    await appDialog.saveBytes({
        bytes,
        fileName: `${sanitizeFileName(pkg.preset.name || 'preset')}.${extension}`,
        mimeType: presetFileMimeType(request),
        title: 'Export Preset',
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
    });
}

export async function getGlobalVariable(key: string): Promise<string | null> {
    const preset = getActivePreset();
    if (!preset) return null;
    return preset.globalVariables[key] ?? null;
}

export function getGlobalVariables(): Record<string, string> {
    const preset = getActivePreset();
    if (!preset) return {};
    return { ...preset.globalVariables };
}

export async function setGlobalVariable(key: string, value: string): Promise<void> {
    const preset = getActivePreset();
    if (!preset) return;
    await updatePresetContent(preset.id, {
        globalVariables: { ...preset.globalVariables, [key]: value }
    });
}

export async function setGlobalVariables(values: Record<string, string>): Promise<void> {
    const preset = getActivePreset();
    if (!preset) return;
    await updatePresetContent(preset.id, { globalVariables: { ...values } });
}
