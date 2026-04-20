import { readText, writeText, readImage } from '@tauri-apps/plugin-clipboard-manager';
import type { Image } from '@tauri-apps/api/image';
import type { IClipboardAdapter } from './types';
import { AppError } from '$lib/types/errors';
import { createLogger } from '$lib/adapters/logger';

const logger = createLogger('adapter:clipboard:tauri');

/**
 * Tauri Clipboard Adapter
 *
 * Uses `@tauri-apps/plugin-clipboard-manager` to interact with the OS clipboard.
 */
export class TauriClipboardAdapter implements IClipboardAdapter {
    async readText(): Promise<string | null> {
        try {
            const hasText = await readText();
            return hasText || null;
        } catch (error) {
            logger.error('Failed to read text from clipboard (Tauri):', error);
            return null;
        }
    }

    async writeText(text: string): Promise<void> {
        try {
            await writeText(text);
        } catch (error) {
            throw new AppError(
                'CLIPBOARD_ERROR',
                `Failed to write to clipboard (Tauri): ${error instanceof Error ? error.message : String(error)}`,
                error
            );
        }
    }

    async readImage(): Promise<Uint8Array | null> {
        try {
            // plugin returns an image object. Need to be careful with formats, but readImage usually returns RGBA bytes or similar.
            // Depending on the exact version of tauri-plugin-clipboard-manager, the return signature might vary.
            // By default, it returns an Image object which can be converted to Uint8Array.
            const image: Image | null = await readImage();
            if (!image) return null;
            const rgbaBytes = await image.rgba();
            return new Uint8Array(rgbaBytes);
        } catch (error) {
            logger.error('Failed to read image from clipboard (Tauri):', error);
            return null;
        }
    }

    async writeImage(_data: Uint8Array): Promise<void> {
        // ─── TODO: Implement full image conversion ─────────────────────────────
        // Tauri's writeImage requires a structured Image object (with width/height/format).
        // Raw Uint8Array bytes without metadata cannot be directly written.
        // Need to parse PNG/JPG headers to extract dimensions and create proper Image object.
        throw new AppError(
            'NOT_IMPLEMENTED',
            'writeImage is not yet supported in Tauri. Requires Image metadata (width/height/format) from raw bytes.'
        );
    }
}
