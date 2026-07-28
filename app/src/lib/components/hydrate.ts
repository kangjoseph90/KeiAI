import type { Action } from 'svelte/action';
import { AssetService, type AssetReadLocator, type AssetUrlLease } from '$lib/services/asset';
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
    const loaded = new WeakMap<AssetElement, { key: string; lease: AssetUrlLease }>();
    const leaseCache = new Map<string, AssetUrlLease>();
    const loading = new Set<AssetElement>();
    const retryCounts = new WeakMap<AssetElement, number>();
    const ownedLeases = new Set<AssetUrlLease>();
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
            if (!leaseCache.has(cached.key)) {
                releaseLease(cached.lease);
            }
            element.removeAttribute('src');
        }

        if (cached?.key === key) {
            if (element.getAttribute('src') !== cached.lease.url) {
                element.src = cached.lease.url;
            }
            stopObserving(element);
            return;
        }

        const cachedLease = leaseCache.get(key);
        if (cachedLease) {
            bindRecovery(element);
            element.src = cachedLease.url;
            element.dataset.keiaiAssetState = 'loaded';
            loaded.set(element, { key, lease: cachedLease });
            ownedLeases.add(cachedLease);
            stopObserving(element);
            return;
        }

        loading.add(element);
        element.dataset.keiaiAssetState = 'loading';

        try {
            const lease = await AssetService.acquireUrl(locator);
            if (destroyed || !element.isConnected || element.dataset.keiaiAsset !== asset) {
                if (lease) void lease.release();
                return;
            }

            if (!lease) {
                element.dataset.keiaiAssetState = 'error';
                return;
            }

            bindRecovery(element);
            element.src = lease.url;
            element.dataset.keiaiAssetState = 'loaded';
            ownedLeases.add(lease);
            loaded.set(element, { key, lease });
            leaseCache.set(key, lease);
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
                    leaseCache.delete(stale.key);
                    releaseLease(stale.lease);
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
                if (element.getAttribute('src') !== cached.lease.url) {
                    element.src = cached.lease.url;
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

        for (const [key, lease] of leaseCache) {
            if (activeKeys.has(key)) continue;
            leaseCache.delete(key);
            releaseLease(lease);
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
            for (const lease of ownedLeases) {
                void lease.release();
            }
            ownedLeases.clear();
            leaseCache.clear();
        }
    };

    function releaseLease(lease: AssetUrlLease): void {
        if (!ownedLeases.delete(lease)) return;
        void lease.release();
    }

    function stopObserving(element: AssetElement): void {
        observer.unobserve(element);
        observed.delete(element);
    }
};
