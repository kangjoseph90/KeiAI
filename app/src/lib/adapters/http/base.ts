import { type IHttpAdapter, type HttpOptions, HttpError } from './types';

/**
 * Abstract Base Class for HTTP Adapters
 *
 * Implements common logic for get/post and response handling
 * to follow DRY principles across Web and Tauri platforms.
 */
export abstract class BaseHttpAdapter implements IHttpAdapter {
	abstract fetch(url: string, init?: RequestInit, options?: HttpOptions): Promise<Response>;

	async get<T>(url: string, headers?: Record<string, string>, options?: HttpOptions): Promise<T> {
		const response = await this.fetch(url, { headers }, options);
		return this.handleResponse<T>(response);
	}

	async post<T>(
		url: string,
		body: unknown,
		headers?: Record<string, string>,
		options?: HttpOptions
	): Promise<T> {
		const { finalBody, defaultHeaders } = this.serializeBody(body);

		const response = await this.fetch(
			url,
			{
				method: 'POST',
				headers: {
					...defaultHeaders,
					...headers
				},
				body: finalBody
			},
			options
		);

		return this.handleResponse<T>(response);
	}

	protected async handleResponse<T>(response: Response): Promise<T> {
		if (!response.ok) {
			let body: string | undefined;
			try {
				body = await response.text();
			} catch {
				// Ignore body parsing errors
			}
			throw new HttpError(response.status, response.statusText, body);
		}
		return response.json();
	}

	protected serializeBody(body: unknown): {
		finalBody: BodyInit | undefined;
		defaultHeaders: Record<string, string>;
	} {
		if (body instanceof FormData || body instanceof URLSearchParams || body instanceof Blob) {
			return { finalBody: body as BodyInit, defaultHeaders: {} };
		}

		if (typeof body === 'string') {
			return { finalBody: body, defaultHeaders: { 'Content-Type': 'text/plain' } };
		}

		if (body === null || body === undefined) {
			return { finalBody: undefined, defaultHeaders: {} };
		}

		// Default to JSON for objects/arrays
		return {
			finalBody: JSON.stringify(body),
			defaultHeaders: { 'Content-Type': 'application/json' }
		};
	}
}
