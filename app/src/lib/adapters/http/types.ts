/**
 * HTTP Adapter Interface
 *
 * Used for cross-platform network requests.
 * On the Web, it falls back to the native `fetch` API.
 * On Tauri, it uses the `@tauri-apps/plugin-http` to bypass CORS restrictions.
 */

export interface IHttpAdapter {
	fetch(url: string, init?: RequestInit): Promise<Response>;
	get<T>(url: string, headers?: Record<string, string>): Promise<T>;
	post<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T>;
}
