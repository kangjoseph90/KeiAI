import { textDecoder, textEncoder } from '$lib/crypto';
import { AppError } from '$lib/types/errors';
import { readRisuPreset, readRisuPresetJson } from './risu';
import type { KeiPresetPackageV1 } from './types';
import { detectFileKind } from '$lib/utils/file';

export type PresetFileExport = { kind: 'keipreset' };

export async function readPresetFile(file: File): Promise<KeiPresetPackageV1> {
    const name = file.name.toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (name.endsWith('.risup') || name.endsWith('.risupreset')) {
        return readRisuPreset(bytes, name.endsWith('.risup'));
    }
    if (name.endsWith('.json') || name.endsWith('.keipreset')) {
        return readRisuPresetJson(JSON.parse(textDecoder.decode(bytes)) as unknown);
    }

    if (detectFileKind(bytes) === 'json') {
        return readRisuPresetJson(JSON.parse(textDecoder.decode(bytes)) as unknown);
    }
    try {
        return await readRisuPreset(bytes, true);
    } catch {
        try {
            return await readRisuPreset(bytes, false);
        } catch {
            // Fall through to the user-facing unsupported-file error.
        }
    }

    throw new AppError('INVALID_INPUT', `Unsupported preset file: ${file.name}`);
}

export async function writePresetFile(
    pkg: KeiPresetPackageV1,
    _request: PresetFileExport
): Promise<Uint8Array> {
    return textEncoder.encode(JSON.stringify(pkg, null, 2));
}

export function presetFileExtension(_request: PresetFileExport): string {
    return 'keipreset';
}

export function presetFileMimeType(_request: PresetFileExport): string {
    return 'application/json';
}
