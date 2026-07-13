import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import type { IDialogAdapter, FileDialogOptions, SaveBytesOptions } from './types';
import {
    detectFileKind,
    fileNameFromPath,
    mimeTypeForFileKind,
    mimeTypeFromName,
    withDetectedExtension
} from '$lib/utils/file';

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
    const kind = detectFileKind(bytes);
    const name = withDetectedExtension(fileNameFromPath(path), kind);
    const namedMime = mimeTypeFromName(name);
    return new File([bytes.slice()], name, {
        type: namedMime === 'application/octet-stream' ? mimeTypeForFileKind(kind) : namedMime
    });
}
