import type { Action } from 'svelte/action';
import { AssetService, type AssetReadLocator } from '$lib/services/asset';
import { assetRegistryId } from '$lib/adapters/asset';

const ASSET_SELECTOR = 'img[data-keiai-asset]';
const MAX_RETRIES = 2;

function parseAssetLocator(raw: string | undefined): AssetReadLocator | null {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export const hydrateAssets: Action<HTMLElement, string | undefined> = (node) => {
    const loaded = new WeakMap<HTMLImageElement, { key: string; url: string }>();
    const urlCache = new Map<string, string>();
    const loading = new Set<HTMLImageElement>();
    const retryCounts = new WeakMap<HTMLImageElement, number>();
    const ownedUrls = new Set<string>();
    const boundRecovery = new WeakSet<HTMLImageElement>();
    const observed = new Set<HTMLImageElement>();
    let destroyed = false;

    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const img = entry.target as HTMLImageElement;
                stopObserving(img);
                void hydrate(img);
            }
        },
        { rootMargin: '200px' }
    );

    async function hydrate(img: HTMLImageElement): Promise<void> {
        if (destroyed || loading.has(img)) return;

        const asset = img.dataset.keiaiAsset;
        const locator = parseAssetLocator(asset);
        if (!locator) return;

        const key = assetRegistryId(locator);

        const cached = loaded.get(img);
        if (cached && cached.key !== key) {
            loaded.delete(img);
            if (!urlCache.has(cached.key)) {
                releaseUrl(cached.url);
            }
            img.removeAttribute('src');
        }

        if (cached?.key === key) {
            if (img.getAttribute('src') !== cached.url) {
                img.src = cached.url;
            }
            stopObserving(img);
            return;
        }

        const cachedUrl = urlCache.get(key);
        if (cachedUrl) {
            bindRecovery(img);
            img.src = cachedUrl;
            img.dataset.keiaiAssetState = 'loaded';
            loaded.set(img, { key, url: cachedUrl });
            ownedUrls.add(cachedUrl);
            stopObserving(img);
            return;
        }

        loading.add(img);
        img.dataset.keiaiAssetState = 'loading';

        try {
            const url = await AssetService.read(locator);
            if (destroyed || !img.isConnected || img.dataset.keiaiAsset !== asset) {
                if (url) void AssetService.revokeUrl(url);
                return;
            }

            if (!url) {
                img.dataset.keiaiAssetState = 'error';
                return;
            }

            bindRecovery(img);
            img.src = url;
            img.dataset.keiaiAssetState = 'loaded';
            ownedUrls.add(url);
            loaded.set(img, { key, url });
            urlCache.set(key, url);
            stopObserving(img);
        } catch {
            if (!destroyed && img.isConnected && img.dataset.keiaiAsset === asset) {
                img.dataset.keiaiAssetState = 'error';
            }
        } finally {
            loading.delete(img);
        }
    }

    function bindRecovery(img: HTMLImageElement): void {
        if (boundRecovery.has(img)) return;
        boundRecovery.add(img);

        img.addEventListener('error', () => {
            const asset = img.dataset.keiaiAsset;
            const locator = parseAssetLocator(asset);
            if (destroyed || !img.isConnected || !locator) return;

            const key = assetRegistryId(locator);

            const retryCount = retryCounts.get(img) ?? 0;
            if (retryCount >= MAX_RETRIES) {
                const stale = loaded.get(img);
                loaded.delete(img);
                if (stale) {
                    urlCache.delete(stale.key);
                    releaseUrl(stale.url);
                }
                img.removeAttribute('src');
                img.dataset.keiaiAssetState = 'error';
                return;
            }

            retryCounts.set(img, retryCount + 1);
            loaded.delete(img);
            img.removeAttribute('src');
            img.dataset.keiaiAssetState = 'loading';
            void hydrate(img);
        });
    }

    function scan(): void {
        if (destroyed) return;

        const activeKeys = new Set<string>();
        const activeImages = new Set<HTMLImageElement>();
        node.querySelectorAll<HTMLImageElement>(ASSET_SELECTOR).forEach((img) => {
            activeImages.add(img);
            const asset = img.dataset.keiaiAsset;
            const locator = parseAssetLocator(asset);
            if (!locator) return;

            const key = assetRegistryId(locator);
            activeKeys.add(key);

            const cached = loaded.get(img);
            if (cached?.key === key) {
                if (img.getAttribute('src') !== cached.url) {
                    img.src = cached.url;
                }
                return;
            }
            if (loading.has(img)) return;
            observer.observe(img);
            observed.add(img);
        });

        for (const img of observed) {
            if (!activeImages.has(img)) stopObserving(img);
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

    function stopObserving(img: HTMLImageElement): void {
        observer.unobserve(img);
        observed.delete(img);
    }
};
