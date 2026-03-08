import type { IDialogAdapter, FileDialogOptions } from './types';

/**
 * Web Dialog Adapter
 *
 * Uses browser primitives for dialogs.
 * Note: openFile/saveFile return empty strings or blobs since the web cannot access absolute file paths.
 * Real file content reading requires `<input type="file">` which is best handled in Svelte components.
 * This adapter provides basic fallbacks.
 */
export class WebDialogAdapter implements IDialogAdapter {
	async openFile(_options?: FileDialogOptions): Promise<string | null> {
		// Cannot return a raw path on the web.
		// Returns a dummy path to indicate "success" if you were to wire this to an input element
		// but realistically, you should use an Upload button in the UI for the web.
		console.warn('openFile is not fully supported on the web. Returning null.');
		return null;
	}

	async openMultipleFiles(_options?: FileDialogOptions): Promise<string[] | null> {
		console.warn('openMultipleFiles is not fully supported on the web. Returning null.');
		return null;
	}

	async saveFile(_options?: FileDialogOptions): Promise<string | null> {
		console.warn('saveFile is not fully supported on the web. Returning null.');
		return null;
	}

	async message(text: string, _title?: string): Promise<void> {
		alert(text);
	}

	async confirm(text: string, _title?: string): Promise<boolean> {
		return window.confirm(text);
	}
}

export const webDialog = new WebDialogAdapter();
