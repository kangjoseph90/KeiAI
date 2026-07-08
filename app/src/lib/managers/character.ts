import { importCharacterPackage as importCharacterPackageToStore } from '$lib/stores';
import {
    exportCharacterPackage,
    readCharacterFile,
    writeCharacterFile,
    type CharacterFileExport
} from '$lib/porters/character';
import type { Character } from '$lib/services';
import { sanitizeFileName } from '$lib/utils/file';
import { appDialog } from '$lib/adapters/dialog';

export type ExportCharacterFileRequest = CharacterFileExport;

export interface ImportCharacterFileOptions {
    allowLightAssets?: boolean;
    select?: boolean;
}

export async function importCharacterFile(
    options: ImportCharacterFileOptions = {}
): Promise<Character | null> {
    const file = await appDialog.openFile({
        title: 'Import Character',
        filters: [
            {
                name: 'Character files',
                extensions: ['json', 'png', 'charx', 'jpg', 'jpeg', 'keichar']
            }
        ]
    });
    if (!file) return null;
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
    const assetMode = request.kind === 'keichar' ? request.assetMode : 'baked';
    const pkg = await exportCharacterPackage(characterId, assetMode);
    const bytes = await writeCharacterFile(pkg, request);
    const extension = exportExtension(request);
    const mimeType = exportMimeType(request);

    await appDialog.saveBytes({
        bytes,
        fileName: `${sanitizeFileName(pkg.character.name || 'character')}.${extension}`,
        mimeType,
        title: 'Export Character',
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
    });
}

function exportExtension(request: ExportCharacterFileRequest): string {
    return request.kind === 'keichar' ? 'keichar' : request.format;
}

function exportMimeType(request: ExportCharacterFileRequest): string {
    if (request.kind === 'ccv3' && request.format === 'png') return 'image/png';
    return 'application/zip';
}
