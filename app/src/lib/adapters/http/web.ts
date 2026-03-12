import type { IHttpAdapter, HttpOptions } from './types';
import { fetchWithRetry } from './retry';
import { AppError } from '$lib/shared/errors';

/**
 * Web HTTP Adapter
 *
 * Wraps the browser's native `fetch` API.
 * Subject to CORS restrictions.
 */
export class WebHttpAdapter implements IHttpAdapter {
	async fetch(url: string, init?: RequestInit, options?: HttpOptions): Promise<Response> {
		let finalUrl = url;
		let finalInit = init || {};

		if (options?.proxy) {
			const proxyUrl = import.meta.env.VITE_PROXY_URL;
			const proxyKey = import.meta.env.VITE_PROXY_API_KEY;

			if (!proxyUrl) {
				console.warn('[WebHttpAdapter] VITE_PROXY_URL is not set. Falling back to direct fetch.');
			} else {
				const targetHeaders: Record<string, string> = {};
				const headers = new Headers(finalInit.headers);
				headers.forEach((value, key) => {
					targetHeaders[key] = value;
				});

				const proxyHeaders = new Headers();
				proxyHeaders.set('x-target-url', url);
				proxyHeaders.set('x-target-method', finalInit.method || 'GET');
				proxyHeaders.set('x-target-headers', encodeURIComponent(JSON.stringify(targetHeaders)));
				if (proxyKey) {
					proxyHeaders.set('x-proxy-api-key', proxyKey);
				}

				finalUrl = proxyUrl;
				finalInit = {
					...finalInit,
					method: 'POST',
					headers: proxyHeaders
				};
			}
		}

		try {
			return await fetchWithRetry(() => fetch(finalUrl, finalInit), options?.retry);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError(
				'NETWORK_ERROR',
				`Failed to fetch: ${error instanceof Error ? error.message : String(error)}`,
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

export const webHttp = new WebHttpAdapter();
