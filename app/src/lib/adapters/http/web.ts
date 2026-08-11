import type { HttpOptions, ProxyRuntimeConfig } from './types';
import { fetchWithRetry } from './retry';
import { BaseHttpAdapter } from './base';
import { buildUrl } from '$lib/utils/url';

/**
 * Web HTTP Adapter
 *
 * Wraps the browser's native `fetch` API.
 * Subject to CORS restrictions.
 */
export class WebHttpAdapter extends BaseHttpAdapter {
    private proxyConfig: ProxyRuntimeConfig = { mode: 'direct' };

    configureProxy(config: ProxyRuntimeConfig): void {
        this.proxyConfig = config;
    }

    getProxyConfig(): ProxyRuntimeConfig {
        return this.proxyConfig;
    }

    async fetch(url: string, init?: RequestInit, options?: HttpOptions): Promise<Response> {
        let finalUrl = url;
        let baseInit = { ...init };

        if (options?.proxy) {
            if (this.proxyConfig.mode === 'proxy') {
                const proxyUrl = buildUrl(this.proxyConfig.baseUrl, '/proxy');
                const targetHeaders: Record<string, string> = {};
                const headers = new Headers(baseInit.headers);
                headers.forEach((value, key) => {
                    targetHeaders[key] = value;
                });

                const proxyHeaders = new Headers();
                proxyHeaders.set('x-target-url', url);
                proxyHeaders.set('x-target-method', baseInit.method || 'GET');
                proxyHeaders.set(
                    'x-target-headers',
                    encodeURIComponent(JSON.stringify(targetHeaders))
                );

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
