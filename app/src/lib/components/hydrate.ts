import type { Action } from 'svelte/action';
import { AssetService } from '$lib/services/asset';

const ASSET_SELECTOR = 'img[data-keiai-asset-id]';
const MAX_RETRIES = 2;

export const hydrateAssets: Action<HTMLElement, string | undefined> = (node) => {
    const loaded = new WeakMap<HTMLImageElement, { assetId: string; url: string }>();
    const loading = new Set<HTMLImageElement>();
    const retryCounts = new WeakMap<HTMLImageElement, number>();
    const ownedUrls = new Set<string>();
    const boundRecovery = new WeakSet<HTMLImageElement>();
    let destroyed = false;

    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                void hydrate(entry.target as HTMLImageElement);
            }
        },
        { rootMargin: '200px' }
    );

    async function hydrate(img: HTMLImageElement): Promise<void> {
        if (destroyed || loading.has(img)) return;

        const assetId = img.dataset.keiaiAssetId;
        if (!assetId) return;

        const cached = loaded.get(img);
        if (cached && cached.assetId !== assetId) {
            loaded.delete(img);
            releaseUrl(cached.url);
            img.removeAttribute('src');
        }

        if (cached?.assetId === assetId) {
            if (img.getAttribute('src') !== cached.url) {
                img.src = cached.url;
            }
            observer.unobserve(img);
            return;
        }

        loading.add(img);
        img.dataset.keiaiAssetState = 'loading';

        try {
            const url = await AssetService.read(assetId);
            if (destroyed || !img.isConnected || img.dataset.keiaiAssetId !== assetId) {
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
            loaded.set(img, { assetId, url });
            observer.unobserve(img);
        } catch {
            if (!destroyed && img.isConnected && img.dataset.keiaiAssetId === assetId) {
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
            const assetId = img.dataset.keiaiAssetId;
            if (destroyed || !img.isConnected || !assetId) return;

            const retryCount = retryCounts.get(img) ?? 0;
            if (retryCount >= MAX_RETRIES) {
                const cached = loaded.get(img);
                if (cached) {
                    loaded.delete(img);
                    releaseUrl(cached.url);
                }
                img.removeAttribute('src');
                img.dataset.keiaiAssetState = 'error';
                return;
            }

            retryCounts.set(img, retryCount + 1);
            const cached = loaded.get(img);
            if (cached) {
                loaded.delete(img);
                releaseUrl(cached.url);
            }
            img.removeAttribute('src');
            img.dataset.keiaiAssetState = 'loading';
            void hydrate(img);
        });
    }

    function scan(): void {
        if (destroyed) return;

        node.querySelectorAll<HTMLImageElement>(ASSET_SELECTOR).forEach((img) => {
            const assetId = img.dataset.keiaiAssetId;
            const cached = loaded.get(img);
            if (assetId && cached?.assetId === assetId) {
                if (img.getAttribute('src') !== cached.url) {
                    img.src = cached.url;
                }
                return;
            }
            if (loading.has(img)) return;
            observer.observe(img);
        });
    }

    scan();

    return {
        update() {
            scan();
        },
        destroy() {
            destroyed = true;
            observer.disconnect();
            for (const url of ownedUrls) {
                void AssetService.revokeUrl(url);
            }
            ownedUrls.clear();
        }
    };

    function releaseUrl(url: string): void {
        if (!ownedUrls.delete(url)) return;
        void AssetService.revokeUrl(url);
    }
};
