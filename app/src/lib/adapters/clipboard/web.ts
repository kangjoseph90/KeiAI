import type { IClipboardAdapter } from './types';
import { AppError } from '$lib/types/errors';
import { createLogger } from '$lib/adapters/logger';

const logger = createLogger('adapter:clipboard:web');

/**
 * Web Clipboard Adapter
 *
 * Uses `navigator.clipboard`.
 * Reading images is partially supported across browsers and usually requires user interaction/permissions.
 */
export class WebClipboardAdapter implements IClipboardAdapter {
	async readText(): Promise<string | null> {
		try {
			if (!navigator.clipboard) return null;
			return await navigator.clipboard.readText();
		} catch (error) {
			logger.error('Failed to read text from clipboard:', error);
			return null;
		}
	}

	async writeText(text: string): Promise<void> {
		try {
			if (!navigator.clipboard) {
				throw new Error('Clipboard API not available');
			}
			await navigator.clipboard.writeText(text);
		} catch (error) {
			throw new AppError(
				'CLIPBOARD_ERROR',
				`Failed to write to clipboard: ${error instanceof Error ? error.message : String(error)}`,
				error
			);
		}
	}

	async readImage(): Promise<Uint8Array | null> {
		try {
			if (!navigator.clipboard) return null;
			const items = await navigator.clipboard.read();
			for (const item of items) {
				for (const type of item.types) {
					if (type.startsWith('image/')) {
						const blob = await item.getType(type);
						return new Uint8Array(await blob.arrayBuffer());
					}
				}
			}
			return null;
		} catch (error) {
			logger.error('Failed to read image from clipboard:', error);
			return null;
		}
	}

	async writeImage(data: Uint8Array): Promise<void> {
		try {
			if (!navigator.clipboard) {
				throw new Error('Clipboard API not available');
			}
			// Fallback assumption to png for web
			const buffer = data.buffer.slice(
				data.byteOffset,
				data.byteOffset + data.byteLength
			) as ArrayBuffer;
			const blob = new Blob([buffer], { type: 'image/png' });
			const item = new ClipboardItem({ 'image/png': blob });
			await navigator.clipboard.write([item]);
		} catch (error) {
			throw new AppError(
				'CLIPBOARD_ERROR',
				`Failed to write image to clipboard: ${error instanceof Error ? error.message : String(error)}`,
				error
			);
		}
	}
}

export const webClipboard = new WebClipboardAdapter();
