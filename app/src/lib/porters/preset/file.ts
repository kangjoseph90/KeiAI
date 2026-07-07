import { AppError } from '$lib/types/errors';
import { readRisuPreset, readRisuPresetJson } from './risu';
import type { KeiPresetPackageV1 } from './types';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export type PresetFileExport = { kind: 'keipreset' };

export async function readPresetFile(file: File): Promise<KeiPresetPackageV1> {
    const name = file.name.toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (name.endsWith('.risup') || name.endsWith('.risupreset')) {
        return readRisuPreset(bytes, name.endsWith('.risup'));
    }
    if (name.endsWith('.json') || name.endsWith('.keipreset')) {
        return readRisuPresetJson(JSON.parse(TEXT_DECODER.decode(bytes)) as unknown);
    }

    throw new AppError('INVALID_INPUT', `Unsupported preset file: ${file.name}`);
}

export async function writePresetFile(
    pkg: KeiPresetPackageV1,
    _request: PresetFileExport
): Promise<Uint8Array> {
    return TEXT_ENCODER.encode(JSON.stringify(pkg, null, 2));
}

export function presetFileExtension(_request: PresetFileExport): string {
    return 'keipreset';
}

export function presetFileMimeType(_request: PresetFileExport): string {
    return 'application/json';
}
