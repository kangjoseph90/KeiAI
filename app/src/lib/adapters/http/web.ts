import type { IHttpAdapter } from './types';
import { AppError } from '$lib/shared/errors';

/**
 * Web HTTP Adapter
 *
 * Wraps the browser's native `fetch` API.
 * Subject to CORS restrictions.
 */
export class WebHttpAdapter implements IHttpAdapter {
	async fetch(url: string, init?: RequestInit): Promise<Response> {
		try {
			return await fetch(url, init);
		} catch (error) {
			throw new AppError(
				'NETWORK_ERROR',
				`Failed to fetch: ${error instanceof Error ? error.message : String(error)}`,
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

export const webHttp = new WebHttpAdapter();
