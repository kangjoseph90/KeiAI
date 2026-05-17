import {
    exportModuleToKei,
    moduleFileExtension,
    readModuleFile,
    writeModuleFile,
    type ModuleFileExport
} from '$lib/porters/module';
import { importModulePackage as importModulePackageToStore } from '$lib/stores';
import type { Module } from '$lib/services';
import { downloadBytes, sanitizeFileName } from '$lib/utils/file';

export async function importModuleFile(
    file: File,
    options: { allowLightAssets?: boolean; select?: boolean } = {}
): Promise<Module> {
    const pkg = await readModuleFile(file);
    return importModulePackageToStore(pkg, {
        allowLightAssets: options.allowLightAssets ?? false,
        select: options.select
    });
}

export async function exportModuleFile(moduleId: string, request: ModuleFileExport): Promise<void> {
    const pkg = await exportModuleToKei(moduleId, { mode: 'baked' });
    const bytes = await writeModuleFile(pkg, request);
    downloadBytes(
        bytes,
        `${sanitizeFileName(pkg.module.name || 'module')}.${moduleFileExtension(request)}`,
        'application/octet-stream'
    );
}
