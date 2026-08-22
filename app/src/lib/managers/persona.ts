import {
    exportPersonaPackage,
    personaFileExtension,
    readPersonaFile,
    writePersonaFile,
    type PersonaFileExport
} from '$lib/porters/persona';
import { importPersonaPackage as importPersonaPackageToStore } from '$lib/stores';
import type { PorterProgressReporter } from '$lib/porters/progress';
import { trackPorterProgress } from '$lib/porters/progress';
import type { Persona } from '$lib/services';
import { sanitizeFileName } from '$lib/utils/file';
import { appDialog } from '$lib/adapters/dialog';

export async function importPersonaFile(
    options: {
        allowLightAssets?: boolean;
        select?: boolean;
        onProgress?: PorterProgressReporter;
    } = {}
): Promise<Persona | null> {
    const file = await appDialog.openFile({
        title: 'Import Persona',
        filters: [{ name: 'Persona files', extensions: ['png', 'keipersona'] }]
    });
    if (!file) return null;
    options.onProgress?.({ phase: 'preparing', completed: 0, total: 0 });
    const pkg = await readPersonaFile(file);
    return importPersonaPackageToStore(pkg, {
        allowLightAssets: options.allowLightAssets ?? false,
        select: options.select,
        onProgress: options.onProgress
    });
}

export async function exportPersonaFile(
    personaId: string,
    request: PersonaFileExport,
    onProgress?: PorterProgressReporter
): Promise<void> {
    const assetMode = request.kind === 'keipersona' ? request.assetMode : 'baked';
    const tracked = trackPorterProgress(onProgress);
    const pkg = await exportPersonaPackage(personaId, assetMode, tracked?.report);
    tracked?.report({ ...tracked.last(), phase: 'finalizing' });
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
