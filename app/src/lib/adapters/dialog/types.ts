export interface FileFilter {
    name: string;
    extensions: string[];
}

export interface FileDialogOptions {
    title?: string;
    filters?: FileFilter[];
    defaultPath?: string;
}

export interface SaveBytesOptions extends FileDialogOptions {
    bytes: Uint8Array;
    fileName: string;
    mimeType: string;
}

/**
 * Dialog Adapter Interface
 *
 * Used for native file selection and file saving.
 */
export interface IDialogAdapter {
    openFile(options?: FileDialogOptions): Promise<File | null>;
    openMultipleFiles(options?: FileDialogOptions): Promise<File[] | null>;
    saveBytes(options: SaveBytesOptions): Promise<boolean>;
}
