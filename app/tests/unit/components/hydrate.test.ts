import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hydrateAssets, reconcileHydratedAssetSlots } from '$lib/components/hydrate';
import { AssetService, createAssetUri } from '$lib/services/asset';
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
    encKey: 'key-1',
    width: 640,
    height: 960
};

const testLocator2: AssetReadLocator = {
    scopeType: 'user',
    scopeId: 'user-1',
    ownerTable: 'characters',
    ownerId: 'char-2',
    hash: 'hash-2',
    encKey: 'key-2',
    width: 1280,
    height: 720
};

vi.mock('$lib/services/asset', async (importOriginal) => {
    const actual = await importOriginal<typeof import('$lib/services/asset')>();
    return {
        ...actual,
        AssetService: {
            acquireUrl: vi.fn()
        }
    };
});

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
        node.innerHTML = `<img src="${createAssetUri(testLocator)}" alt="" />`;
        document.body.appendChild(node);

        const action = hydrateAssets(node);
        const img = node.querySelector('img') as HTMLImageElement;

        expect(AssetService.acquireUrl).not.toHaveBeenCalled();
        expect(observers).toHaveLength(1);

        observers[0].trigger(img);
        await vi.waitFor(() => expect(AssetService.acquireUrl).toHaveBeenCalledWith(testLocator));
        await vi.waitFor(() => expect(img.src).toContain('blob:asset-1'));

        action?.destroy?.();

        expect(lease.release).toHaveBeenCalledOnce();
    });

    it('reserves raw image layout from locator dimensions before loading the asset', () => {
        const locator: AssetReadLocator = {
            ...testLocator,
            width: 1024,
            height: 1536
        };
        const node = document.createElement('div');
        node.innerHTML = `<img src="${createAssetUri(locator)}" alt="" />`;
        document.body.appendChild(node);

        hydrateAssets(node);
        const img = node.querySelector('img') as HTMLImageElement;

        expect(img.getAttribute('width')).toBe('1024');
        expect(img.getAttribute('height')).toBe('1536');
        expect(AssetService.acquireUrl).not.toHaveBeenCalled();
    });

    it('does not override author-provided raw image dimensions', () => {
        const locator: AssetReadLocator = {
            ...testLocator,
            width: 1024,
            height: 1536
        };
        const node = document.createElement('div');
        node.innerHTML = `<img src="${createAssetUri(locator)}" width="240" alt="" />`;
        document.body.appendChild(node);

        hydrateAssets(node);
        const img = node.querySelector('img') as HTMLImageElement;

        expect(img.getAttribute('width')).toBe('240');
        expect(img.getAttribute('height')).toBe('360');
        expect(AssetService.acquireUrl).not.toHaveBeenCalled();
    });

    it('eagerly hydrates legacy images that have no reservable dimensions', async () => {
        const lease = createLease('blob:legacy-image');
        vi.mocked(AssetService.acquireUrl).mockResolvedValue(lease);
        const locator: AssetReadLocator = {
            scopeType: 'user',
            scopeId: 'user-1',
            ownerTable: 'characters',
            ownerId: 'char-legacy',
            hash: 'hash-legacy',
            encKey: 'key-legacy'
        };
        const node = document.createElement('div');
        node.innerHTML = `<img src="${createAssetUri(locator)}" alt="" />`;
        document.body.appendChild(node);

        hydrateAssets(node);
        const img = node.querySelector('img') as HTMLImageElement;

        await vi.waitFor(() => expect(AssetService.acquireUrl).toHaveBeenCalledWith(locator));
        await vi.waitFor(() => expect(img.src).toContain(lease.url));
    });

    it('hydrates native audio and video elements', async () => {
        vi.mocked(AssetService.acquireUrl)
            .mockResolvedValueOnce(createLease('blob:audio-1'))
            .mockResolvedValueOnce(createLease('blob:video-1'));

        const node = document.createElement('div');
        node.innerHTML = [
            `<audio src="${createAssetUri(testLocator)}"></audio>`,
            `<video src="${createAssetUri(testLocator2)}"></video>`
        ].join('');
        document.body.appendChild(node);

        hydrateAssets(node);
        const audio = node.querySelector('audio') as HTMLAudioElement;
        const video = node.querySelector('video') as HTMLVideoElement;

        observers[0].trigger(audio);
        observers[0].trigger(video);

        await vi.waitFor(() => expect(audio.src).toContain('blob:audio-1'));
        await vi.waitFor(() => expect(video.src).toContain('blob:video-1'));
    });

    it('revokes cached URLs when their images leave the hydrated DOM', async () => {
        const lease = createLease('blob:removed-asset');
        vi.mocked(AssetService.acquireUrl).mockResolvedValue(lease);

        const node = document.createElement('div');
        node.innerHTML = `<img src="${createAssetUri(testLocator)}" alt="" />`;
        document.body.appendChild(node);

        const action = hydrateAssets(node);
        const img = node.querySelector('img') as HTMLImageElement;

        observers[0].trigger(img);
        await vi.waitFor(() => expect(img.src).toContain(lease.url));

        img.remove();
        action?.update?.(undefined);

        expect(lease.release).toHaveBeenCalledOnce();
    });

    it('reuses cached URL on error retry and cleans up after MAX_RETRIES', async () => {
        const lease = createLease('blob:asset-2');
        vi.mocked(AssetService.acquireUrl).mockResolvedValue(lease);

        const node = document.createElement('div');
        node.innerHTML = `<img src="${createAssetUri(testLocator2)}" alt="" />`;
        document.body.appendChild(node);

        hydrateAssets(node);
        const img = node.querySelector('img') as HTMLImageElement;

        observers[0].trigger(img);
        await vi.waitFor(() => expect(AssetService.acquireUrl).toHaveBeenCalledWith(testLocator2));
        await vi.waitFor(() => expect(img.src).toContain(lease.url));

        const originalLoadCount = vi.mocked(AssetService.acquireUrl).mock.calls.length;

        // Error retries reuse cached URL — no additional read() calls
        img.dispatchEvent(new Event('error'));
        expect(img.getAttribute('src')).toContain('#keiai-asset:');
        await vi.waitFor(() => expect(img.src).toContain(lease.url));
        img.dispatchEvent(new Event('error'));
        expect(img.getAttribute('src')).toContain('#keiai-asset:');
        await vi.waitFor(() => expect(img.src).toContain(lease.url));

        // Third error exceeds MAX_RETRIES → source removed, urlCache evicted
        img.dispatchEvent(new Event('error'));
        expect(img.hasAttribute('src')).toBe(false);

        // read() was called only once (initial load, no retries via read)
        expect(vi.mocked(AssetService.acquireUrl).mock.calls.length).toBe(originalLoadCount);

        // Evicted URL is revoked
        expect(lease.release).toHaveBeenCalledOnce();
    });

    it('hydrates asset URIs in inline styles when their element becomes visible', async () => {
        const lease = createLease('blob:inline-background');
        vi.mocked(AssetService.acquireUrl).mockResolvedValue(lease);

        const node = document.createElement('div');
        const assetUri = createAssetUri(testLocator);
        node.innerHTML = `<div style="background-image:url('${assetUri}')"></div>`;
        document.body.appendChild(node);

        const action = hydrateAssets(node);
        const target = node.firstElementChild as HTMLElement;

        expect(target.getAttribute('style')).toContain(assetUri);
        expect(AssetService.acquireUrl).not.toHaveBeenCalled();

        observers[0].trigger(target);
        await vi.waitFor(() => expect(target.getAttribute('style')).toContain(lease.url));

        action?.destroy?.();
        expect(lease.release).toHaveBeenCalledOnce();
    });

    it('hydrates style blocks when their host becomes visible', async () => {
        const lease = createLease('blob:scoped-background');
        vi.mocked(AssetService.acquireUrl).mockResolvedValue(lease);

        const node = document.createElement('div');
        const assetUri = createAssetUri(testLocator);
        node.innerHTML = `<style>.message{background-image:url("${assetUri}")}</style><p>Visible</p>`;
        document.body.appendChild(node);

        const action = hydrateAssets(node);
        const style = node.querySelector('style') as HTMLStyleElement;

        expect(style.textContent).toContain(assetUri);
        expect(AssetService.acquireUrl).not.toHaveBeenCalled();

        observers[0].trigger(node);
        await vi.waitFor(() => expect(style.textContent).toContain(lease.url));

        action?.destroy?.();
        expect(lease.release).toHaveBeenCalledOnce();
    });

    it('preserves every hydrated slot when morphing the same canonical asset output', async () => {
        const lease = createLease('blob:shared-asset');
        vi.mocked(AssetService.acquireUrl).mockResolvedValue(lease);

        const assetUri = createAssetUri(testLocator);
        const html = [
            `<video src="${assetUri}" poster="${assetUri}" style="background-image:url('${assetUri}')"></video>`,
            `<a href="${assetUri}">asset</a>`,
            `<style>.asset{background-image:url("${assetUri}")}</style>`
        ].join('');
        const node = document.createElement('div');
        node.innerHTML = html;
        document.body.appendChild(node);

        const action = hydrateAssets(node);
        const video = node.querySelector('video') as HTMLVideoElement;
        const anchor = node.querySelector('a') as HTMLAnchorElement;
        const style = node.querySelector('style') as HTMLStyleElement;

        observers[0].trigger(video);
        observers[0].trigger(anchor);
        observers[0].trigger(node);

        await vi.waitFor(() => {
            expect(video.getAttribute('src')).toContain(lease.url);
            expect(video.getAttribute('poster')).toContain(lease.url);
            expect(video.getAttribute('style')).toContain(lease.url);
            expect(anchor.getAttribute('href')).toContain(lease.url);
            expect(style.textContent).toContain(lease.url);
        });

        const target = document.createElement('div');
        target.innerHTML = html;
        const targetVideo = target.querySelector('video') as HTMLVideoElement;
        const targetAnchor = target.querySelector('a') as HTMLAnchorElement;
        const targetStyle = target.querySelector('style') as HTMLStyleElement;
        targetVideo.className = 'updated';
        targetVideo.setAttribute('style', `opacity:0.5;background-image:url('${assetUri}')`);
        targetStyle.textContent = `.asset{background-image:url("${assetUri}");opacity:0.5}`;

        reconcileHydratedAssetSlots(video, targetVideo);
        reconcileHydratedAssetSlots(anchor, targetAnchor);
        reconcileHydratedAssetSlots(style, targetStyle);

        expect(targetVideo.getAttribute('src')).toContain(lease.url);
        expect(targetVideo.getAttribute('poster')).toContain(lease.url);
        expect(targetVideo.getAttribute('style')).toContain(lease.url);
        expect(targetVideo.getAttribute('style')).toContain('opacity:0.5');
        expect(targetVideo.className).toBe('updated');
        expect(targetAnchor.getAttribute('href')).toContain(lease.url);
        expect(targetStyle.textContent).toContain(lease.url);
        expect(targetStyle.textContent).toContain('opacity:0.5');

        const changedAnchor = document.createElement('a');
        const changedUri = createAssetUri(testLocator2);
        changedAnchor.setAttribute('href', changedUri);
        reconcileHydratedAssetSlots(anchor, changedAnchor);
        expect(changedAnchor.getAttribute('href')).toBe(changedUri);

        action?.destroy?.();
    });
});
