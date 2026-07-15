import {
    exportModulePackage,
    moduleFileExtension,
    readModuleFile,
    writeModuleFile,
    type ModuleFileExport
} from '$lib/porters/module';
import { importModulePackage as importModulePackageToStore } from '$lib/stores';
import type { Module } from '$lib/services';
import { sanitizeFileName } from '$lib/utils/file';
import { appDialog } from '$lib/adapters/dialog';

export async function importModuleFile(
    options: { allowLightAssets?: boolean; select?: boolean } = {}
): Promise<Module | null> {
    const file = await appDialog.openFile({
        title: 'Import Module',
        filters: [{ name: 'Module files', extensions: ['risum', 'keimodule', 'json'] }]
    });
    if (!file) return null;
    const pkg = await readModuleFile(file);
    return importModulePackageToStore(pkg, {
        allowLightAssets: options.allowLightAssets ?? false,
        select: options.select
    });
}

export async function exportModuleFile(moduleId: string, request: ModuleFileExport): Promise<void> {
    const assetMode = request.kind === 'keimodule' ? request.assetMode : 'baked';
    const pkg = await exportModulePackage(moduleId, assetMode);
    const bytes = await writeModuleFile(pkg, request);
    const extension = moduleFileExtension(request);
    await appDialog.saveBytes({
        bytes,
        fileName: `${sanitizeFileName(pkg.module.name || 'module')}.${extension}`,
        mimeType: 'application/octet-stream',
        title: 'Export Module',
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
    });
}
