import type { Action } from 'svelte/action';
import { AssetService, type AssetReadLocator } from '$lib/services/asset';
import { assetRegistryId } from '$lib/adapters/asset';

const ASSET_SELECTOR = 'img[data-keiai-asset],audio[data-keiai-asset],video[data-keiai-asset]';
const MAX_RETRIES = 2;
type AssetElement = HTMLImageElement | HTMLAudioElement | HTMLVideoElement;

function parseAssetLocator(raw: string | undefined): AssetReadLocator | null {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export const hydrateAssets: Action<HTMLElement, string | undefined> = (node) => {
    const loaded = new WeakMap<AssetElement, { key: string; url: string }>();
    const urlCache = new Map<string, string>();
    const loading = new Set<AssetElement>();
    const retryCounts = new WeakMap<AssetElement, number>();
    const ownedUrls = new Set<string>();
    const boundRecovery = new WeakSet<AssetElement>();
    const observed = new Set<AssetElement>();
    let destroyed = false;

    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const element = entry.target as AssetElement;
                stopObserving(element);
                void hydrate(element);
            }
        },
        { rootMargin: '200px' }
    );

    async function hydrate(element: AssetElement): Promise<void> {
        if (destroyed || loading.has(element)) return;

        const asset = element.dataset.keiaiAsset;
        const locator = parseAssetLocator(asset);
        if (!locator) return;

        const key = assetRegistryId(locator);

        const cached = loaded.get(element);
        if (cached && cached.key !== key) {
            loaded.delete(element);
            if (!urlCache.has(cached.key)) {
                releaseUrl(cached.url);
            }
            element.removeAttribute('src');
        }

        if (cached?.key === key) {
            if (element.getAttribute('src') !== cached.url) {
                element.src = cached.url;
            }
            stopObserving(element);
            return;
        }

        const cachedUrl = urlCache.get(key);
        if (cachedUrl) {
            bindRecovery(element);
            element.src = cachedUrl;
            element.dataset.keiaiAssetState = 'loaded';
            loaded.set(element, { key, url: cachedUrl });
            ownedUrls.add(cachedUrl);
            stopObserving(element);
            return;
        }

        loading.add(element);
        element.dataset.keiaiAssetState = 'loading';

        try {
            const url = await AssetService.read(locator);
            if (destroyed || !element.isConnected || element.dataset.keiaiAsset !== asset) {
                if (url) void AssetService.revokeUrl(url);
                return;
            }

            if (!url) {
                element.dataset.keiaiAssetState = 'error';
                return;
            }

            bindRecovery(element);
            element.src = url;
            element.dataset.keiaiAssetState = 'loaded';
            ownedUrls.add(url);
            loaded.set(element, { key, url });
            urlCache.set(key, url);
            stopObserving(element);
        } catch {
            if (!destroyed && element.isConnected && element.dataset.keiaiAsset === asset) {
                element.dataset.keiaiAssetState = 'error';
            }
        } finally {
            loading.delete(element);
        }
    }

    function bindRecovery(element: AssetElement): void {
        if (boundRecovery.has(element)) return;
        boundRecovery.add(element);

        element.addEventListener('error', () => {
            const asset = element.dataset.keiaiAsset;
            const locator = parseAssetLocator(asset);
            if (destroyed || !element.isConnected || !locator) return;

            const key = assetRegistryId(locator);

            const retryCount = retryCounts.get(element) ?? 0;
            if (retryCount >= MAX_RETRIES) {
                const stale = loaded.get(element);
                loaded.delete(element);
                if (stale) {
                    urlCache.delete(stale.key);
                    releaseUrl(stale.url);
                }
                element.removeAttribute('src');
                element.dataset.keiaiAssetState = 'error';
                return;
            }

            retryCounts.set(element, retryCount + 1);
            loaded.delete(element);
            element.removeAttribute('src');
            element.dataset.keiaiAssetState = 'loading';
            void hydrate(element);
        });
    }

    function scan(): void {
        if (destroyed) return;

        const activeKeys = new Set<string>();
        const activeElements = new Set<AssetElement>();
        node.querySelectorAll<AssetElement>(ASSET_SELECTOR).forEach((element) => {
            activeElements.add(element);
            const asset = element.dataset.keiaiAsset;
            const locator = parseAssetLocator(asset);
            if (!locator) return;

            const key = assetRegistryId(locator);
            activeKeys.add(key);

            const cached = loaded.get(element);
            if (cached?.key === key) {
                if (element.getAttribute('src') !== cached.url) {
                    element.src = cached.url;
                }
                return;
            }
            if (loading.has(element)) return;
            observer.observe(element);
            observed.add(element);
        });

        for (const element of observed) {
            if (!activeElements.has(element)) stopObserving(element);
        }

        for (const [key, url] of urlCache) {
            if (activeKeys.has(key)) continue;
            urlCache.delete(key);
            releaseUrl(url);
        }
    }

    scan();

    return {
        update() {
            scan();
        },
        destroy() {
            destroyed = true;
            observer.disconnect();
            observed.clear();
            for (const url of ownedUrls) {
                void AssetService.revokeUrl(url);
            }
            ownedUrls.clear();
            urlCache.clear();
        }
    };

    function releaseUrl(url: string): void {
        if (!ownedUrls.delete(url)) return;
        void AssetService.revokeUrl(url);
    }

    function stopObserving(element: AssetElement): void {
        observer.unobserve(element);
        observed.delete(element);
    }
};
