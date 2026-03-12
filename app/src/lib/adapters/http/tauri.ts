import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { IHttpAdapter, HttpOptions } from './types';
import { fetchWithRetry } from './retry';
import { AppError } from '$lib/shared/errors';

/**
 * Tauri HTTP Adapter
 *
 * Uses `@tauri-apps/plugin-http` to make requests.
 * This bypasses WebView CORS restrictions entirely, as requests are made by the Rust backend.
 */
export class TauriHttpAdapter implements IHttpAdapter {
	async fetch(url: string, init?: RequestInit, options?: HttpOptions): Promise<Response> {
		try {
			// `options.proxy` is intentionally ignored: Tauri's Rust HTTP backend makes
			// requests outside the WebView, bypassing CORS entirely, so proxying is unnecessary.
			return await fetchWithRetry(() => tauriFetch(url, init), options?.retry);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError(
				'NETWORK_ERROR',
				`Tauri fetch failed: ${error instanceof Error ? error.message : String(error)}`,
				error
			);
		}
	}

	async get<T>(url: string, headers?: Record<string, string>, options?: HttpOptions): Promise<T> {
		const response = await this.fetch(url, { headers }, options);
		if (!response.ok) {
			throw new AppError('NETWORK_ERROR', `HTTP error! status: ${response.status}`);
		}
		return response.json();
	}

	async post<T>(
		url: string,
		body: unknown,
		headers?: Record<string, string>,
		options?: HttpOptions
	): Promise<T> {
		const response = await this.fetch(
			url,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...headers
				},
				body: JSON.stringify(body)
			},
			options
		);
		if (!response.ok) {
			throw new AppError('NETWORK_ERROR', `HTTP error! status: ${response.status}`);
		}
		return response.json();
	}
}
