import {
    exportPersonaToKei,
    personaFileExtension,
    readPersonaFile,
    writePersonaFile,
    type PersonaFileExport
} from '$lib/porters/persona';
import { importPersonaPackage as importPersonaPackageToStore } from '$lib/stores';
import type { Persona } from '$lib/services';
import { downloadBytes, sanitizeFileName } from '$lib/utils/file';

export async function importPersonaFile(
    file: File,
    options: { allowLightAssets?: boolean; select?: boolean } = {}
): Promise<Persona> {
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
    const pkg = await exportPersonaToKei(personaId, { mode: 'baked' });
    const bytes = await writePersonaFile(pkg, request);
    downloadBytes(
        bytes,
        `${sanitizeFileName(pkg.persona.name || 'persona')}.${personaFileExtension(request)}`,
        request.kind === 'risu' ? 'image/png' : 'application/octet-stream'
    );
}
