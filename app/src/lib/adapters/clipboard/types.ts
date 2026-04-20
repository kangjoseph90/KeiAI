/**
 * Clipboard Adapter Interface
 *
 * Used for reading and writing text/images to the system clipboard.
 */
export interface IClipboardAdapter {
    readText(): Promise<string | null>;
    writeText(text: string): Promise<void>;
    readImage(): Promise<Uint8Array | null>;
    writeImage(data: Uint8Array): Promise<void>;
}
