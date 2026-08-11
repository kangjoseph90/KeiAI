import { AppError } from '$lib/types/errors';
import { KEI_CDN_URL } from '$lib/config';
import { buildUrl } from './url';
import { appHttp } from '$lib/adapters/http';

const CACHE_NAME = 'kei-cdn-v1';

function resolveCdnUrl(path: string): string {
    return import.meta.env.DEV ? path : buildUrl(KEI_CDN_URL, path);
}

async function fetchCdnResponse(url: string): Promise<Response> {
    const response = await appHttp.fetch(url);
    if (!response.ok) {
        throw new AppError('ASSET_ERROR', `CDN fetch failed: ${response.status} ${url}`);
    }
    return response;
}

/**
 * Fetch a resource from the CDN and store it persistently in the browser's cache.
 * Uses the Cache API to ensure the resource stays available after page reloads or Tauri restarts.
 *
 * @param path - Resource path (e.g., '/token/claude/tokenizer.json' or '/models/...')
 */
export async function cdnFetch(path: string): Promise<ArrayBuffer> {
    const url = resolveCdnUrl(path);

    if (import.meta.env.DEV) {
        return (await fetchCdnResponse(url)).arrayBuffer();
    }

    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url);

    if (cached) {
        return await cached.arrayBuffer();
    }

    const response = await fetchCdnResponse(url);

    // Persist response to cache
    await cache.put(url, response.clone());

    return await response.arrayBuffer();
}
