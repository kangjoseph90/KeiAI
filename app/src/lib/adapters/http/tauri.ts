import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { IHttpAdapter } from './types';
import { AppError } from '$lib/shared/errors';

/**
 * Tauri HTTP Adapter
 *
 * Uses `@tauri-apps/plugin-http` to make requests.
 * This bypasses WebView CORS restrictions entirely, as requests are made by the Rust backend.
 */
export class TauriHttpAdapter implements IHttpAdapter {
	async fetch(url: string, init?: RequestInit): Promise<Response> {
		try {
			// tauriFetch is highly compatible with the standard fetch API
			return await tauriFetch(url, init);
		} catch (error) {
			throw new AppError(
				'NETWORK_ERROR',
				`Tauri fetch failed: ${error instanceof Error ? error.message : String(error)}`,
				error
			);
		}
	}

	async get<T>(url: string, headers?: Record<string, string>): Promise<T> {
		const response = await this.fetch(url, { headers });
		if (!response.ok) {
			throw new AppError('NETWORK_ERROR', `HTTP error! status: ${response.status}`);
		}
		return response.json();
	}

	async post<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
		const response = await this.fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...headers
			},
			body: JSON.stringify(body)
		});
		if (!response.ok) {
			throw new AppError('NETWORK_ERROR', `HTTP error! status: ${response.status}`);
		}
		return response.json();
	}
}
