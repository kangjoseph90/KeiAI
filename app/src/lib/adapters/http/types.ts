/**
 * HTTP Adapter Interface
 *
 * Used for cross-platform network requests.
 * On the Web, it falls back to the native `fetch` API.
 * On Tauri, it uses the `@tauri-apps/plugin-http` to bypass CORS restrictions.
 */

export interface RetryOptions {
    /** Maximum number of retries (default: 0 = no retry) */
    maxRetries?: number;
    /** Initial delay in ms (default: 1000) */
    baseDelayMs?: number;
    /** Maximum delay cap in ms (default: 30000) */
    maxDelayMs?: number;
    /** HTTP status codes that trigger a retry (default: [408, 429, 500, 502, 503, 504]) */
    retryableStatuses?: number[];
}

export interface HttpOptions {
    proxy?: boolean;
    retry?: RetryOptions;
    /** Request timeout in milliseconds. If not set, no timeout is applied. */
    timeout?: number;
    /** AbortSignal to cancel the request manually. */
    signal?: AbortSignal;
}

export type ProxyRuntimeConfig = { mode: 'proxy'; baseUrl: string } | { mode: 'direct' };

export interface IHttpAdapter {
    configureProxy(config: ProxyRuntimeConfig): void;
    getProxyConfig(): ProxyRuntimeConfig;
    fetch(url: string, init?: RequestInit, options?: HttpOptions): Promise<Response>;
    get<T>(url: string, headers?: Record<string, string>, options?: HttpOptions): Promise<T>;
    post<T>(
        url: string,
        body: unknown,
        headers?: Record<string, string>,
        options?: HttpOptions
    ): Promise<T>;
}

export class HttpError extends Error {
    constructor(
        public status: number,
        public statusText: string,
        public body?: string
    ) {
        super(`HTTP Error: ${status} ${statusText}`);
        this.name = 'HttpError';
    }
}
