import { AppError } from '$lib/types/errors';
import { readCharX, writeCharX } from './charx';
import type { CharacterFileExport } from './export';
import { readCharacterJson } from './json';
import { readKeiChar, writeKeiChar } from './keichar';
import { readCharacterPng, writeCharacterPng } from './png';
import type { KeiCharacterPackageV1 } from './types';

export async function readCharacterFile(file: File): Promise<KeiCharacterPackageV1> {
    const name = file.name.toLowerCase();
    if (name.endsWith('.json')) return readCharacterJson(file);
    if (name.endsWith('.png')) return readCharacterPng(file);
    if (name.endsWith('.charx') || name.endsWith('.jpg') || name.endsWith('.jpeg')) {
        return readCharX(file);
    }
    if (name.endsWith('.keichar')) return readKeiChar(file);
    throw new AppError('INVALID_INPUT', `Unsupported character file: ${file.name}`);
}

export async function writeCharacterFile(
    pkg: KeiCharacterPackageV1,
    request: CharacterFileExport
): Promise<Uint8Array> {
    if (request.kind === 'keichar') return writeKeiChar(pkg);
    if (request.format === 'png') return writeCharacterPng(pkg);
    return writeCharX(pkg);
}
