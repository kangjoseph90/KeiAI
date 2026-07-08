import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import type { IDialogAdapter, FileDialogOptions, SaveBytesOptions } from './types';

/**
 * Tauri Dialog Adapter
 *
 * Uses `@tauri-apps/plugin-dialog` to show OS-native file pickers.
 */
export class TauriDialogAdapter implements IDialogAdapter {
    async openFile(options?: FileDialogOptions): Promise<File | null> {
        const result = await open({
            multiple: false,
            directory: false,
            title: options?.title,
            defaultPath: options?.defaultPath,
            filters: options?.filters
        });
        return typeof result === 'string' ? await readPathAsFile(result) : null;
    }

    async openMultipleFiles(options?: FileDialogOptions): Promise<File[] | null> {
        const result = await open({
            multiple: true,
            directory: false,
            title: options?.title,
            defaultPath: options?.defaultPath,
            filters: options?.filters
        });
        return Array.isArray(result) ? await Promise.all(result.map(readPathAsFile)) : null;
    }

    async saveBytes(options: SaveBytesOptions): Promise<boolean> {
        const path = await save({
            title: options.title,
            filters: options.filters,
            defaultPath: options.defaultPath ?? options.fileName
        });
        if (!path) return false;
        await writeFile(path, options.bytes);
        return true;
    }
}

async function readPathAsFile(path: string): Promise<File> {
    const bytes = await readFile(path);
    const name = fileNameFromPath(path);
    return new File([bytes.slice()], name, { type: mimeTypeFromName(name) });
}

function fileNameFromPath(path: string): string {
    return path.split(/[\\/]/).pop() || 'file';
}

function mimeTypeFromName(name: string): string {
    const extension = name.split('.').pop()?.toLowerCase();
    if (extension === 'png') return 'image/png';
    if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
    if (extension === 'webp') return 'image/webp';
    if (extension === 'gif') return 'image/gif';
    if (extension === 'json' || extension === 'keipreset') return 'application/json';
    if (
        extension === 'zip' ||
        extension === 'charx' ||
        extension === 'keichar' ||
        extension === 'keimodule' ||
        extension === 'keipersona'
    ) {
        return 'application/zip';
    }
    return 'application/octet-stream';
}
