import { importCharacterPackage as importCharacterPackageToStore } from '$lib/stores';
import {
    exportCharacterPackage,
    readCharacterFile,
    writeCharacterFile,
    type CharacterFileExport
} from '$lib/porters/character';
import type { Character } from '$lib/services';

export type ExportCharacterFileRequest = CharacterFileExport;

export interface ImportCharacterFileOptions {
    allowLightAssets?: boolean;
    select?: boolean;
}

export async function importCharacterFile(
    file: File,
    options: ImportCharacterFileOptions = {}
): Promise<Character> {
    const pkg = await readCharacterFile(file);
    return importCharacterPackageToStore(pkg, {
        allowLightAssets: options.allowLightAssets ?? false,
        select: options.select
    });
}

export async function exportCharacterFile(
    characterId: string,
    request: ExportCharacterFileRequest
): Promise<void> {
    const assetMode = request.kind === 'ccv3' ? 'baked' : request.assetMode;
    const pkg = await exportCharacterPackage(characterId, assetMode);
    const bytes = await writeCharacterFile(pkg, request);
    const extension = exportExtension(request);
    const mimeType = exportMimeType(request);

    downloadBytes(
        bytes,
        `${sanitizeFileName(pkg.character.name || 'character')}.${extension}`,
        mimeType
    );
}

function exportExtension(request: ExportCharacterFileRequest): string {
    return request.kind === 'keichar' ? 'keichar' : request.format;
}

function exportMimeType(request: ExportCharacterFileRequest): string {
    if (request.kind === 'ccv3' && request.format === 'png') return 'image/png';
    return 'application/zip';
}

function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string): void {
    const blob = new Blob([bytes.slice()], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}

function sanitizeFileName(value: string): string {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || 'character';
}
