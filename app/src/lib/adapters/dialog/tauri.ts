import { open, save, message, confirm } from '@tauri-apps/plugin-dialog';
import type { IDialogAdapter, FileDialogOptions } from './types';

/**
 * Tauri Dialog Adapter
 *
 * Uses `@tauri-apps/plugin-dialog` to show OS-native file pickers and message boxes.
 */
export class TauriDialogAdapter implements IDialogAdapter {
    async openFile(options?: FileDialogOptions): Promise<string | null> {
        const result = await open({
            multiple: false,
            directory: false,
            title: options?.title,
            defaultPath: options?.defaultPath,
            filters: options?.filters
        });
        return result as string | null;
    }

    async openMultipleFiles(options?: FileDialogOptions): Promise<string[] | null> {
        const result = await open({
            multiple: true,
            directory: false,
            title: options?.title,
            defaultPath: options?.defaultPath,
            filters: options?.filters
        });
        return result as string[] | null;
    }

    async saveFile(options?: FileDialogOptions): Promise<string | null> {
        const result = await save({
            title: options?.title,
            defaultPath: options?.defaultPath,
            filters: options?.filters
        });
        return result as string | null;
    }

    async message(text: string, title?: string): Promise<void> {
        await message(text, { title });
    }

    async confirm(text: string, title?: string): Promise<boolean> {
        return confirm(text, { title });
    }
}
