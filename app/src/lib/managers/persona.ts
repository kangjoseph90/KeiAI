import {
    exportPersonaPackage,
    personaFileExtension,
    readPersonaFile,
    writePersonaFile,
    type PersonaFileExport
} from '$lib/porters/persona';
import { importPersonaPackage as importPersonaPackageToStore } from '$lib/stores';
import type { Persona } from '$lib/services';
import { sanitizeFileName } from '$lib/utils/file';
import { appDialog } from '$lib/adapters/dialog';

export async function importPersonaFile(
    options: { allowLightAssets?: boolean; select?: boolean } = {}
): Promise<Persona | null> {
    const file = await appDialog.openFile({
        title: 'Import Persona',
        filters: [{ name: 'Persona files', extensions: ['png', 'keipersona'] }]
    });
    if (!file) return null;
    const pkg = await readPersonaFile(file);
    return importPersonaPackageToStore(pkg, {
        allowLightAssets: options.allowLightAssets ?? false,
        select: options.select
    });
}

export async function exportPersonaFile(
    personaId: string,
    request: PersonaFileExport
): Promise<void> {
    const assetMode = request.kind === 'keipersona' ? request.assetMode : 'baked';
    const pkg = await exportPersonaPackage(personaId, assetMode);
    const bytes = await writePersonaFile(pkg, request);
    const extension = personaFileExtension(request);
    await appDialog.saveBytes({
        bytes,
        fileName: `${sanitizeFileName(pkg.persona.name || 'persona')}.${extension}`,
        mimeType: request.kind === 'risu' ? 'image/png' : 'application/octet-stream',
        title: 'Export Persona',
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
    });
}
