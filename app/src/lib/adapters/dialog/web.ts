import type { IDialogAdapter, FileDialogOptions, SaveBytesOptions } from './types';
import { createLogger } from '$lib/adapters/logger';

const logger = createLogger('adapter:dialog:web');

/**
 * Web Dialog Adapter
 *
 * Uses browser primitives for dialogs.
 * Uses transient DOM elements for browser file picking and downloads.
 * The rest of the app should call this adapter instead of creating file inputs
 * or download anchors directly.
 */
export class WebDialogAdapter implements IDialogAdapter {
    async openFile(options?: FileDialogOptions): Promise<File | null> {
        const files = await this.openMultipleFiles(options);
        return files?.[0] ?? null;
    }

    async openMultipleFiles(options?: FileDialogOptions): Promise<File[] | null> {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = acceptString(options?.filters);
            input.onchange = () => resolve(input.files ? Array.from(input.files) : null);
            input.oncancel = () => resolve(null);
            input.click();
        });
    }

    async saveBytes(options: SaveBytesOptions): Promise<boolean> {
        const blob = new Blob([options.bytes.slice()], { type: options.mimeType });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = options.fileName;
        anchor.click();
        URL.revokeObjectURL(url);
        return true;
    }
}

function acceptString(filters?: FileDialogOptions['filters']): string {
    return filters?.flatMap((filter) => filter.extensions.map((ext) => `.${ext}`)).join(',') ?? '';
}

export const webDialog = new WebDialogAdapter();
