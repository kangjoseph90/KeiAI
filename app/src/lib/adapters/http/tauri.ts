import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { IHttpAdapter, HttpOptions } from './types';
import { fetchWithRetry } from './retry';

import { BaseHttpAdapter } from './base';

/**
 * Tauri HTTP Adapter
 *
 * Uses `@tauri-apps/plugin-http` to make requests.
 * This bypasses WebView CORS restrictions entirely, as requests are made by the Rust backend.
 */
export class TauriHttpAdapter extends BaseHttpAdapter {
	async fetch(url: string, init?: RequestInit, options?: HttpOptions): Promise<Response> {
		const baseInit = { ...init };

		// `options.proxy` is intentionally ignored: Tauri's Rust HTTP backend makes
		// requests outside the WebView, bypassing CORS entirely, so proxying is unnecessary.
		return await fetchWithRetry(() => {
			let signal = baseInit.signal || options?.signal;
			if (options?.timeout) {
				const timeoutSignal = AbortSignal.timeout(options.timeout);
				signal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
			}

			return tauriFetch(url, { ...baseInit, signal });
		}, options?.retry);
	}
}
