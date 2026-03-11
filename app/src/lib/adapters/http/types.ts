/**
 * HTTP Adapter Interface
 *
 * Used for cross-platform network requests.
 * On the Web, it falls back to the native `fetch` API.
 * On Tauri, it uses the `@tauri-apps/plugin-http` to bypass CORS restrictions.
 */

export interface HttpOptions {
	proxy?: boolean;
}

export interface IHttpAdapter {
	fetch(url: string, init?: RequestInit, options?: HttpOptions): Promise<Response>;
	get<T>(url: string, headers?: Record<string, string>, options?: HttpOptions): Promise<T>;
	post<T>(
		url: string,
		body: unknown,
		headers?: Record<string, string>,
		options?: HttpOptions
	): Promise<T>;
}
