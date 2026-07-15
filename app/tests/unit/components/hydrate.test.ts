import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hydrateAssets } from '$lib/components/hydrate';
import { AssetService } from '$lib/services/asset';
import type { AssetReadLocator } from '$lib/services/asset';

const observers: FakeIntersectionObserver[] = [];

class FakeIntersectionObserver {
    static instances: FakeIntersectionObserver[] = observers;

    private readonly callback: IntersectionObserverCallback;
    private readonly observed = new Set<Element>();

    readonly root: Element | Document | null = null;
    readonly rootMargin = '200px';
    readonly thresholds = [0];

    constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        observers.push(this);
    }

    observe(target: Element): void {
        this.observed.add(target);
    }

    unobserve(target: Element): void {
        this.observed.delete(target);
    }

    disconnect(): void {
        this.observed.clear();
    }

    takeRecords(): IntersectionObserverEntry[] {
        return [];
    }

    trigger(target: Element, isIntersecting = true): void {
        const entry = {
            target,
            isIntersecting,
            intersectionRatio: isIntersecting ? 1 : 0,
            time: 0,
            boundingClientRect: {} as DOMRectReadOnly,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
            isVisible: isIntersecting
        } as unknown as IntersectionObserverEntry;

        this.callback([entry], this as unknown as IntersectionObserver);
    }
}

const testLocator: AssetReadLocator = {
    scopeType: 'user',
    scopeId: 'user-1',
    ownerTable: 'characters',
    ownerId: 'char-1',
    hash: 'hash-1',
    encKey: 'key-1'
};

const testLocator2: AssetReadLocator = {
    scopeType: 'user',
    scopeId: 'user-1',
    ownerTable: 'characters',
    ownerId: 'char-2',
    hash: 'hash-2',
    encKey: 'key-2'
};

vi.mock('$lib/services/asset', () => ({
    AssetService: {
        read: vi.fn(),
        revokeUrl: vi.fn()
    }
}));

describe('hydrateAssets', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        observers.length = 0;
        vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('lazy loads asset urls and revokes them on destroy', async () => {
        vi.mocked(AssetService.read).mockResolvedValue('blob:asset-1');

        const node = document.createElement('div');
        node.innerHTML = `<img data-keiai-asset='${JSON.stringify(testLocator)}' alt="" />`;
        document.body.appendChild(node);

        const action = hydrateAssets(node);
        const img = node.querySelector('img') as HTMLImageElement;

        expect(AssetService.read).not.toHaveBeenCalled();
        expect(observers).toHaveLength(1);

        observers[0].trigger(img);
        await vi.waitFor(() => expect(AssetService.read).toHaveBeenCalledWith(testLocator));
        await vi.waitFor(() => expect(img.dataset.keiaiAssetState).toBe('loaded'));

        expect(img.src).toContain('blob:asset-1');

        action?.destroy?.();

        expect(AssetService.revokeUrl).toHaveBeenCalledWith('blob:asset-1');
    });

    it('revokes cached URLs when their images leave the hydrated DOM', async () => {
        vi.mocked(AssetService.read).mockResolvedValue('blob:removed-asset');

        const node = document.createElement('div');
        node.innerHTML = `<img data-keiai-asset='${JSON.stringify(testLocator)}' alt="" />`;
        document.body.appendChild(node);

        const action = hydrateAssets(node);
        const img = node.querySelector('img') as HTMLImageElement;

        observers[0].trigger(img);
        await vi.waitFor(() => expect(img.dataset.keiaiAssetState).toBe('loaded'));

        img.remove();
        action?.update?.(undefined);

        expect(AssetService.revokeUrl).toHaveBeenCalledWith('blob:removed-asset');
    });

    it('reuses cached URL on error retry and cleans up after MAX_RETRIES', async () => {
        vi.mocked(AssetService.read).mockResolvedValue('blob:asset-2');

        const node = document.createElement('div');
        node.innerHTML = `<img data-keiai-asset='${JSON.stringify(testLocator2)}' alt="" />`;
        document.body.appendChild(node);

        hydrateAssets(node);
        const img = node.querySelector('img') as HTMLImageElement;

        observers[0].trigger(img);
        await vi.waitFor(() => expect(AssetService.read).toHaveBeenCalledWith(testLocator2));
        await vi.waitFor(() => expect(img.dataset.keiaiAssetState).toBe('loaded'));

        const originalLoadCount = vi.mocked(AssetService.read).mock.calls.length;

        // Error retries reuse cached URL — no additional read() calls
        img.dispatchEvent(new Event('error'));
        await vi.waitFor(() => expect(img.dataset.keiaiAssetState).toBe('loaded'));
        img.dispatchEvent(new Event('error'));
        await vi.waitFor(() => expect(img.dataset.keiaiAssetState).toBe('loaded'));

        // Third error exceeds MAX_RETRIES → error state, urlCache evicted
        img.dispatchEvent(new Event('error'));
        await vi.waitFor(() => expect(img.dataset.keiaiAssetState).toBe('error'));

        // read() was called only once (initial load, no retries via read)
        expect(vi.mocked(AssetService.read).mock.calls.length).toBe(originalLoadCount);

        // Evicted URL is revoked
        expect(AssetService.revokeUrl).toHaveBeenCalledWith('blob:asset-2');
    });
});
