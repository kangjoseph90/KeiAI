import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hydrateAssets } from '$lib/components/hydrate';
import { AssetService } from '$lib/services/asset';
import type { AssetReadLocator, AssetUrlLease } from '$lib/services/asset';

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
        acquireUrl: vi.fn()
    }
}));

function createLease(url: string): AssetUrlLease {
    return {
        url,
        release: vi.fn().mockResolvedValue(undefined)
    };
}

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
        const lease = createLease('blob:asset-1');
        vi.mocked(AssetService.acquireUrl).mockResolvedValue(lease);

        const node = document.createElement('div');
        node.innerHTML = `<img data-keiai-asset='${JSON.stringify(testLocator)}' alt="" />`;
        document.body.appendChild(node);

        const action = hydrateAssets(node);
        const img = node.querySelector('img') as HTMLImageElement;

        expect(AssetService.acquireUrl).not.toHaveBeenCalled();
        expect(observers).toHaveLength(1);

        observers[0].trigger(img);
        await vi.waitFor(() => expect(AssetService.acquireUrl).toHaveBeenCalledWith(testLocator));
        await vi.waitFor(() => expect(img.dataset.keiaiAssetState).toBe('loaded'));

        expect(img.src).toContain('blob:asset-1');

        action?.destroy?.();

        expect(lease.release).toHaveBeenCalledOnce();
    });

    it('hydrates native audio and video elements', async () => {
        vi.mocked(AssetService.acquireUrl)
            .mockResolvedValueOnce(createLease('blob:audio-1'))
            .mockResolvedValueOnce(createLease('blob:video-1'));

        const node = document.createElement('div');
        node.innerHTML = [
            `<audio data-keiai-asset='${JSON.stringify(testLocator)}'></audio>`,
            `<video data-keiai-asset='${JSON.stringify(testLocator2)}'></video>`
        ].join('');
        document.body.appendChild(node);

        hydrateAssets(node);
        const audio = node.querySelector('audio') as HTMLAudioElement;
        const video = node.querySelector('video') as HTMLVideoElement;

        observers[0].trigger(audio);
        observers[0].trigger(video);

        await vi.waitFor(() => expect(audio.dataset.keiaiAssetState).toBe('loaded'));
        await vi.waitFor(() => expect(video.dataset.keiaiAssetState).toBe('loaded'));
        expect(audio.src).toContain('blob:audio-1');
        expect(video.src).toContain('blob:video-1');
    });

    it('revokes cached URLs when their images leave the hydrated DOM', async () => {
        const lease = createLease('blob:removed-asset');
        vi.mocked(AssetService.acquireUrl).mockResolvedValue(lease);

        const node = document.createElement('div');
        node.innerHTML = `<img data-keiai-asset='${JSON.stringify(testLocator)}' alt="" />`;
        document.body.appendChild(node);

        const action = hydrateAssets(node);
        const img = node.querySelector('img') as HTMLImageElement;

        observers[0].trigger(img);
        await vi.waitFor(() => expect(img.dataset.keiaiAssetState).toBe('loaded'));

        img.remove();
        action?.update?.(undefined);

        expect(lease.release).toHaveBeenCalledOnce();
    });

    it('reuses cached URL on error retry and cleans up after MAX_RETRIES', async () => {
        const lease = createLease('blob:asset-2');
        vi.mocked(AssetService.acquireUrl).mockResolvedValue(lease);

        const node = document.createElement('div');
        node.innerHTML = `<img data-keiai-asset='${JSON.stringify(testLocator2)}' alt="" />`;
        document.body.appendChild(node);

        hydrateAssets(node);
        const img = node.querySelector('img') as HTMLImageElement;

        observers[0].trigger(img);
        await vi.waitFor(() => expect(AssetService.acquireUrl).toHaveBeenCalledWith(testLocator2));
        await vi.waitFor(() => expect(img.dataset.keiaiAssetState).toBe('loaded'));

        const originalLoadCount = vi.mocked(AssetService.acquireUrl).mock.calls.length;

        // Error retries reuse cached URL — no additional read() calls
        img.dispatchEvent(new Event('error'));
        await vi.waitFor(() => expect(img.dataset.keiaiAssetState).toBe('loaded'));
        img.dispatchEvent(new Event('error'));
        await vi.waitFor(() => expect(img.dataset.keiaiAssetState).toBe('loaded'));

        // Third error exceeds MAX_RETRIES → error state, urlCache evicted
        img.dispatchEvent(new Event('error'));
        await vi.waitFor(() => expect(img.dataset.keiaiAssetState).toBe('error'));

        // read() was called only once (initial load, no retries via read)
        expect(vi.mocked(AssetService.acquireUrl).mock.calls.length).toBe(originalLoadCount);

        // Evicted URL is revoked
        expect(lease.release).toHaveBeenCalledOnce();
    });
});
