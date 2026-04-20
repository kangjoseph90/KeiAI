export interface FileFilter {
    name: string;
    extensions: string[];
}

export interface FileDialogOptions {
    title?: string;
    filters?: FileFilter[];
    defaultPath?: string;
}

/**
 * Dialog Adapter Interface
 *
 * Used for native file selection and message dialogs.
 */
export interface IDialogAdapter {
    openFile(options?: FileDialogOptions): Promise<string | null>;
    openMultipleFiles(options?: FileDialogOptions): Promise<string[] | null>;
    saveFile(options?: FileDialogOptions): Promise<string | null>;
    message(text: string, title?: string): Promise<void>;
    confirm(text: string, title?: string): Promise<boolean>;
}
