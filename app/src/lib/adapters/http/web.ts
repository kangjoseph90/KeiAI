import type { IHttpAdapter, HttpOptions } from './types';
import { fetchWithRetry } from './retry';

import { BaseHttpAdapter } from './base';

/**
 * Web HTTP Adapter
 *
 * Wraps the browser's native `fetch` API.
 * Subject to CORS restrictions.
 */
export class WebHttpAdapter extends BaseHttpAdapter {
	async fetch(url: string, init?: RequestInit, options?: HttpOptions): Promise<Response> {
		let finalUrl = url;
		let baseInit = { ...init };

		if (options?.proxy) {
			const proxyUrl = import.meta.env.VITE_PROXY_URL;

			if (!proxyUrl) {
				console.warn('[WebHttpAdapter] VITE_PROXY_URL is not set. Falling back to direct fetch.');
			} else {
				const targetHeaders: Record<string, string> = {};
				const headers = new Headers(baseInit.headers);
				headers.forEach((value, key) => {
					targetHeaders[key] = value;
				});

				const proxyHeaders = new Headers();
				proxyHeaders.set('x-target-url', url);
				proxyHeaders.set('x-target-method', baseInit.method || 'GET');
				proxyHeaders.set('x-target-headers', encodeURIComponent(JSON.stringify(targetHeaders)));

				finalUrl = proxyUrl;
				baseInit = {
					...baseInit,
					method: 'POST',
					headers: proxyHeaders
				};
			}
		}

		return await fetchWithRetry(() => {
			let signal = baseInit.signal || options?.signal;
			if (options?.timeout) {
				const timeoutSignal = AbortSignal.timeout(options.timeout);
				signal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
			}

			return fetch(finalUrl, { ...baseInit, signal });
		}, options?.retry);
	}
}

export const webHttp = new WebHttpAdapter();
