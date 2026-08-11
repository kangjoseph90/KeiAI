import type { IDialogAdapter, FileDialogOptions, SaveBytesOptions } from './types';

const FILE_PICKER_FOCUS_SETTLE_MS = 150;
const DOWNLOAD_URL_REVOKE_DELAY_MS = 1_000;

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
        const files = await this.pickFiles(false, options);
        return files?.[0] ?? null;
    }

    async openMultipleFiles(options?: FileDialogOptions): Promise<File[] | null> {
        return this.pickFiles(true, options);
    }

    private pickFiles(multiple: boolean, options?: FileDialogOptions): Promise<File[] | null> {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = multiple;
            input.accept = acceptString(options?.filters);
            input.hidden = true;

            let settled = false;
            let focusTimer: ReturnType<typeof setTimeout> | null = null;

            const cleanup = () => {
                if (focusTimer) clearTimeout(focusTimer);
                input.removeEventListener('change', handleChange);
                input.removeEventListener('cancel', handleCancel);
                window.removeEventListener('focus', handleWindowFocus);
                input.remove();
            };
            const settle = (files: File[] | null) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(files);
            };
            const handleChange = () => {
                const files = input.files ? Array.from(input.files) : [];
                settle(files.length > 0 ? files : null);
            };
            const handleCancel = () => settle(null);
            const handleWindowFocus = () => {
                if (focusTimer) clearTimeout(focusTimer);
                focusTimer = setTimeout(() => {
                    focusTimer = null;
                    if (!input.files || input.files.length === 0) settle(null);
                }, FILE_PICKER_FOCUS_SETTLE_MS);
            };

            input.addEventListener('change', handleChange);
            input.addEventListener('cancel', handleCancel);
            window.addEventListener('focus', handleWindowFocus);
            document.body.appendChild(input);

            try {
                input.click();
            } catch (error) {
                settled = true;
                cleanup();
                reject(error);
            }
        });
    }

    async saveBytes(options: SaveBytesOptions): Promise<boolean> {
        const blob = new Blob([options.bytes.slice()], { type: options.mimeType });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = options.fileName;
        anchor.hidden = true;
        document.body.appendChild(anchor);

        try {
            anchor.click();
            return true;
        } finally {
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_REVOKE_DELAY_MS);
        }
    }
}

function acceptString(filters?: FileDialogOptions['filters']): string {
    return filters?.flatMap((filter) => filter.extensions.map((ext) => `.${ext}`)).join(',') ?? '';
}
