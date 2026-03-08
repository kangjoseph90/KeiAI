import type { IWindowAdapter } from './types';

/**
 * Web Window Adapter
 *
 * Provides fallback implementations for the browser environment.
 * The web cannot natively minimize, maximize, or set always on top.
 */
export class WebWindowAdapter implements IWindowAdapter {
	async minimize(): Promise<void> {
		console.warn('Window minimization is not supported on the web.');
	}

	async maximize(): Promise<void> {
		console.warn('Window maximization is not supported on the web.');
	}

	async unmaximize(): Promise<void> {
		console.warn('Window unmaximization is not supported on the web.');
	}

	async close(): Promise<void> {
		window.close();
		console.warn('Window close may not work on the web unless the script opened the window.');
	}

	async setTitle(title: string): Promise<void> {
		document.title = title;
	}

	async setAlwaysOnTop(_alwaysOnTop: boolean): Promise<void> {
		console.warn('setAlwaysOnTop is not supported on the web.');
	}
}

export const webWindow = new WebWindowAdapter();
