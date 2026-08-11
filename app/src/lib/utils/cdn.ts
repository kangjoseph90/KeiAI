import { AppError } from '$lib/types/errors';
import { KEI_CDN_URL } from '$lib/config';
import { buildUrl } from './url';
import { appHttp } from '$lib/adapters/http';

const CACHE_NAME = 'kei-cdn-v1';

/**
 * Fetch a resource from the CDN and store it persistently in the browser's cache.
 * Uses the Cache API to ensure the resource stays available after page reloads or Tauri restarts.
 *
 * @param path - Resource path (e.g., '/token/claude/tokenizer.json' or '/models/...')
 */
export async function cdnFetch(path: string): Promise<ArrayBuffer> {
    const url = buildUrl(KEI_CDN_URL, path);

    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url);

    if (cached) {
        return await cached.arrayBuffer();
    }

    const response = await appHttp.fetch(url);
    if (!response.ok) {
        throw new AppError('ASSET_ERROR', `CDN fetch failed: ${response.status} ${url}`);
    }

    // Persist response to cache
    await cache.put(url, response.clone());

    return await response.arrayBuffer();
}
