import type { Action } from 'svelte/action';
import {
    ASSET_URI_MARKER,
    ASSET_URI_PATTERN,
    AssetService,
    parseAssetUri,
    type AssetReadLocator,
    type AssetUrlLease
} from '$lib/services/asset';
import { assetRegistryId } from '$lib/adapters/asset';
import { sanitizeMermaidSvg } from '$lib/utils/style';
const RESOURCE_ATTRIBUTES = ['src', 'poster', 'href', 'style'] as const;
const MAX_RETRIES = 2;

type ResourceAttribute = (typeof RESOURCE_ATTRIBUTES)[number];
type AssetElement = HTMLImageElement | HTMLAudioElement | HTMLVideoElement;
type Slot = ResourceAttribute | 'text';

interface SlotBinding {
    canonical: string;
    rendered: string;
    replacements: Map<string, { url: string; key: string }>;
}

interface RetryState {
    source: string;
    count: number;
}

const hydratedSlotBindings = new WeakMap<Element, Map<Slot, SlotBinding>>();

function readSlot(element: Element, slot: Slot): string {
    return slot === 'text' ? (element.textContent ?? '') : (element.getAttribute(slot) ?? '');
}

function writeSlot(element: Element, slot: Slot, value: string): void {
    if (slot === 'text') {
        element.textContent = value;
    } else {
        element.setAttribute(slot, value);
    }
}

function findAssetUris(value: string): string[] {
    const matches = value.match(ASSET_URI_PATTERN) ?? [];
    return [...new Set(matches)];
}

function isAssetElement(element: Element): element is AssetElement {
    return (
        element instanceof HTMLImageElement ||
        element instanceof HTMLAudioElement ||
        element instanceof HTMLVideoElement
    );
}

function isAssetDimension(value: number | undefined): value is number {
    return value !== undefined && Number.isInteger(value) && value > 0;
}

export function reconcileHydratedAssetSlots(fromEl: Element, toEl: Element): void {
    if (fromEl.tagName !== toEl.tagName) return;

    const slots = hydratedSlotBindings.get(fromEl);
    if (!slots) return;

    for (const [slot, binding] of slots) {
        if (readSlot(fromEl, slot) !== binding.rendered) continue;

        const canonical = readSlot(toEl, slot);
        let rendered = canonical;
        const retained = new Map<string, { url: string; key: string }>();
        for (const [uri, replacement] of binding.replacements) {
            if (!rendered.includes(uri)) continue;
            rendered = rendered.replaceAll(uri, replacement.url);
            retained.set(uri, replacement);
        }
        if (retained.size === 0) continue;

        binding.canonical = canonical;
        binding.rendered = rendered;
        binding.replacements = retained;
        writeSlot(toEl, slot, rendered);
    }
}

function forgetHydratedAssetSlots(element: Element, slots: Map<Slot, SlotBinding>): void {
    if (hydratedSlotBindings.get(element) === slots) {
        hydratedSlotBindings.delete(element);
    }
}

export const hydrateAssets: Action<HTMLElement, string | undefined> = (node) => {
    const bindings = new Map<Element, Map<Slot, SlotBinding>>();
    const pending = new Map<Element, Set<Slot>>();
    const leaseCache = new Map<string, AssetUrlLease>();
    const leasePromises = new Map<string, Promise<AssetUrlLease | null>>();
    const observed = new Set<Element>();
    const boundRecovery = new WeakSet<AssetElement>();
    const retryStates = new WeakMap<AssetElement, RetryState>();
    let destroyed = false;
    let scanQueued = false;

    const intersectionObserver = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;

                const target = entry.target;
                stopObserving(target);
                if (target === node) {
                    void Promise.all([hydrateElement(target), hydrateHostStyles()]);
                } else {
                    void hydrateElement(target);
                }
            }
        },
        { rootMargin: '1000px' }
    );

    const mutationObserver = new MutationObserver(() => {
        queueScan();
    });
    mutationObserver.observe(node, {
        attributes: true,
        attributeFilter: [...RESOURCE_ATTRIBUTES],
        characterData: true,
        childList: true,
        subtree: true
    });

    function queueScan(): void {
        if (destroyed || scanQueued) return;
        scanQueued = true;
        queueMicrotask(() => {
            scanQueued = false;
            scan();
        });
    }

    function scan(): void {
        if (destroyed) return;

        pending.clear();
        pruneBindings();

        const elements = [node, ...node.querySelectorAll<Element>('*')];
        const eagerElements = new Set<Element>();
        let hasPendingHostStyle = false;

        for (const element of elements) {
            for (const attribute of RESOURCE_ATTRIBUTES) {
                const value = readSlot(element, attribute);
                if (value.includes(ASSET_URI_MARKER)) {
                    if (
                        attribute === 'src' &&
                        (element instanceof HTMLImageElement || element instanceof HTMLVideoElement)
                    ) {
                        const reserved = reserveMediaLayout(element, value);
                        if (element instanceof HTMLImageElement && !reserved) {
                            eagerElements.add(element);
                        }
                    }
                    addPending(element, attribute);
                }
            }

            if (
                element instanceof HTMLStyleElement &&
                readSlot(element, 'text').includes(ASSET_URI_MARKER)
            ) {
                addPending(element, 'text');
                hasPendingHostStyle = true;
            }
        }

        const nextObserved = new Set<Element>();
        for (const [element, slots] of pending) {
            if (element instanceof HTMLStyleElement && slots.has('text')) continue;
            if (eagerElements.has(element)) continue;
            nextObserved.add(element);
        }
        if (hasPendingHostStyle) nextObserved.add(node);

        for (const element of nextObserved) {
            if (observed.has(element)) continue;
            intersectionObserver.observe(element);
            observed.add(element);
        }
        for (const element of [...observed]) {
            if (!nextObserved.has(element)) stopObserving(element);
        }
        for (const element of eagerElements) {
            void hydrateElement(element);
        }

        releaseUnusedLeases();
    }

    function addPending(element: Element, slot: Slot): void {
        const slots = pending.get(element);
        if (slots) {
            slots.add(slot);
        } else {
            pending.set(element, new Set([slot]));
        }
    }

    function reserveMediaLayout(
        element: HTMLImageElement | HTMLVideoElement,
        source: string
    ): boolean {
        const hasWidth = element.hasAttribute('width');
        const hasHeight = element.hasAttribute('height');

        const uri = findAssetUris(source)[0];
        const locator = uri ? parseAssetUri(uri) : null;
        if (!locator || !isAssetDimension(locator.width) || !isAssetDimension(locator.height)) {
            return hasWidth && hasHeight;
        }

        if (hasWidth && hasHeight) return true;

        if (hasWidth) {
            const width = Number(element.getAttribute('width'));
            if (!isAssetDimension(width)) return false;
            element.setAttribute(
                'height',
                String(Math.round((width * locator.height) / locator.width))
            );
        } else if (hasHeight) {
            const height = Number(element.getAttribute('height'));
            if (!isAssetDimension(height)) return false;
            element.setAttribute(
                'width',
                String(Math.round((height * locator.width) / locator.height))
            );
        } else {
            element.setAttribute('width', String(locator.width));
            element.setAttribute('height', String(locator.height));
        }
        return true;
    }

    function pruneBindings(): void {
        for (const [element, slots] of bindings) {
            if (!node.contains(element) && element !== node) {
                bindings.delete(element);
                forgetHydratedAssetSlots(element, slots);
                continue;
            }

            for (const [slot, binding] of slots) {
                const current = readSlot(element, slot);
                if (current !== binding.rendered && current !== binding.canonical) {
                    slots.delete(slot);
                }
            }
            if (slots.size === 0) {
                bindings.delete(element);
                forgetHydratedAssetSlots(element, slots);
            }
        }
    }

    async function hydrateHostStyles(): Promise<void> {
        const tasks: Promise<void>[] = [];
        for (const [element, slots] of pending) {
            if (!element.isConnected || !(element instanceof HTMLStyleElement)) continue;
            if (slots.has('text')) tasks.push(hydrateSlot(element, 'text'));
        }
        await Promise.all(tasks);
    }

    async function hydrateElement(element: Element): Promise<void> {
        const slots = pending.get(element);
        if (!slots || !element.isConnected) return;
        await Promise.all([...slots].map((slot) => hydrateSlot(element, slot)));
    }

    async function hydrateSlot(element: Element, slot: Slot): Promise<void> {
        const original = readSlot(element, slot);
        const uris = findAssetUris(original);
        if (destroyed || uris.length === 0) return;

        const resolved = await Promise.all(
            uris.map(async (uri) => {
                const locator = parseAssetUri(uri);
                if (!locator) return null;
                try {
                    const lease = await acquireLease(locator);
                    return lease ? { uri, locator, lease } : null;
                } catch {
                    return null;
                }
            })
        );

        if (
            destroyed ||
            (!node.contains(element) && element !== node) ||
            readSlot(element, slot) !== original
        ) {
            releaseUnusedLeases();
            return;
        }

        const existingBinding = bindings.get(element)?.get(slot);
        const extendsExisting = existingBinding?.rendered === original;
        const canonical = extendsExisting ? existingBinding.canonical : original;
        let rendered = original;
        const replacements = new Map(extendsExisting ? existingBinding.replacements : undefined);
        for (const entry of resolved) {
            if (!entry) continue;
            rendered = rendered.replaceAll(entry.uri, entry.lease.url);
            replacements.set(entry.uri, {
                url: entry.lease.url,
                key: assetRegistryId(entry.locator)
            });
        }
        if (rendered === original) return;

        const slots = bindings.get(element) ?? new Map<Slot, SlotBinding>();
        slots.set(slot, { canonical, rendered, replacements });
        bindings.set(element, slots);
        hydratedSlotBindings.set(element, slots);
        writeSlot(element, slot, rendered);

        if (isAssetElement(element)) bindRecovery(element);
        queueScan();
    }

    async function acquireLease(locator: AssetReadLocator): Promise<AssetUrlLease | null> {
        const key = assetRegistryId(locator);
        const cached = leaseCache.get(key);
        if (cached) return cached;

        const existing = leasePromises.get(key);
        if (existing) return existing;

        const promise = AssetService.acquireUrl(locator)
            .then((lease) => {
                if (!lease) return null;
                if (destroyed) {
                    void lease.release();
                    return null;
                }
                leaseCache.set(key, lease);
                return lease;
            })
            .finally(() => {
                leasePromises.delete(key);
            });
        leasePromises.set(key, promise);
        return promise;
    }

    function bindRecovery(element: AssetElement): void {
        if (boundRecovery.has(element)) return;
        boundRecovery.add(element);

        element.addEventListener('error', () => {
            if (destroyed || !element.isConnected) return;
            const slots = bindings.get(element);
            const binding = slots?.get('src');
            if (!binding) return;

            const retryState = retryStates.get(element);
            const retryCount = retryState?.source === binding.canonical ? retryState.count : 0;
            if (retryCount >= MAX_RETRIES) {
                slots?.delete('src');
                if (slots?.size === 0) {
                    bindings.delete(element);
                    forgetHydratedAssetSlots(element, slots);
                }
                element.removeAttribute('src');
                releaseUnusedLeases();
                return;
            }

            retryStates.set(element, {
                source: binding.canonical,
                count: retryCount + 1
            });
            slots?.delete('src');
            if (slots?.size === 0) {
                bindings.delete(element);
                forgetHydratedAssetSlots(element, slots);
            }
            writeSlot(element, 'src', binding.canonical);
            void hydrateSlot(element, 'src');
        });
    }

    function releaseUnusedLeases(): void {
        const activeKeys = new Set<string>();

        for (const slots of bindings.values()) {
            for (const binding of slots.values()) {
                for (const replacement of binding.replacements.values()) {
                    activeKeys.add(replacement.key);
                }
            }
        }

        for (const [element, slots] of pending) {
            for (const slot of slots) {
                for (const uri of findAssetUris(readSlot(element, slot))) {
                    const locator = parseAssetUri(uri);
                    if (locator) activeKeys.add(assetRegistryId(locator));
                }
            }
        }

        for (const [key, lease] of leaseCache) {
            if (activeKeys.has(key)) continue;
            leaseCache.delete(key);
            void lease.release();
        }
    }

    function stopObserving(element: Element): void {
        intersectionObserver.unobserve(element);
        observed.delete(element);
    }

    scan();

    return {
        update() {
            scan();
        },
        destroy() {
            destroyed = true;
            mutationObserver.disconnect();
            intersectionObserver.disconnect();
            pending.clear();
            for (const [element, slots] of bindings) {
                forgetHydratedAssetSlots(element, slots);
            }
            bindings.clear();
            observed.clear();
            for (const lease of leaseCache.values()) {
                void lease.release();
            }
            leaseCache.clear();
        }
    };
};

// ── Mermaid diagrams ──────────────────────────────────────────────────

const MERMAID_SELECTOR = '[data-keiai-mermaid]';

type MermaidTheme = 'dark' | 'default';

let mermaidTheme = '';
let mermaidRenderCount = 0;

function currentTheme(): MermaidTheme {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'default';
}

async function loadMermaid(theme: MermaidTheme) {
    const mermaid = (await import('mermaid')).default;
    if (mermaidTheme !== theme) {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme });
        mermaidTheme = theme;
    }
    return mermaid;
}

/**
 * Renders one diagram and re-sanitizes the SVG with the app's DOMPurify
 * boundary before it reaches the DOM. Throws (leaving the escaped source
 * block as the fallback) when the source cannot be parsed.
 */
export async function renderMermaidSvg(
    source: string,
    theme: MermaidTheme = currentTheme()
): Promise<string> {
    const mermaid = await loadMermaid(theme);
    const id = `kei-mermaid-${++mermaidRenderCount}`;
    try {
        const { svg } = await mermaid.render(id, source);
        return sanitizeMermaidSvg(svg);
    } catch (error) {
        document.getElementById(id)?.remove();
        throw error;
    }
}

/** Diagram palettes are fixed at render time; re-render when the app theme flips. */
const mermaidThemeListeners = new Set<() => void>();
let mermaidThemeObserver: MutationObserver | null = null;

function onMermaidThemeChange(listener: () => void): () => void {
    mermaidThemeListeners.add(listener);

    if (!mermaidThemeObserver) {
        mermaidThemeObserver = new MutationObserver(() => {
            for (const notify of mermaidThemeListeners) notify();
        });
        mermaidThemeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class']
        });
    }

    return () => {
        mermaidThemeListeners.delete(listener);
        if (mermaidThemeListeners.size > 0 || !mermaidThemeObserver) return;
        mermaidThemeObserver.disconnect();
        mermaidThemeObserver = null;
    };
}

/** Keeps a rendered diagram across re-renders while its source is unchanged. */
export function isRenderedMermaidPair(fromEl: Element, toEl: Element): boolean {
    if (!fromEl.hasAttribute('data-keiai-mermaid') || !toEl.hasAttribute('data-keiai-mermaid')) {
        return false;
    }
    if (!fromEl.classList.contains('is-rendered')) return false;
    return fromEl.querySelector('code')?.textContent === toEl.querySelector('code')?.textContent;
}

export const hydrateMermaid: Action<HTMLElement, { html: string; generating: boolean }> = (
    node,
    params
) => {
    let destroyed = false;

    function scan(): void {
        if (destroyed || params.generating) return;
        for (const block of node.querySelectorAll<HTMLElement>(MERMAID_SELECTOR)) {
            if (block.classList.contains('is-rendered')) continue;
            void renderBlock(block);
        }
    }

    async function renderBlock(block: HTMLElement): Promise<void> {
        const code = block.querySelector('code');
        const source = code?.textContent ?? '';
        if (!source.trim()) return;

        const theme = currentTheme();
        let svg: string;
        try {
            svg = await renderMermaidSvg(source, theme);
        } catch {
            return; // keep the escaped source block as the fallback
        }
        if (
            destroyed ||
            !node.contains(block) ||
            code?.textContent !== source ||
            currentTheme() !== theme
        ) {
            return;
        }

        const holder = document.createElement('div');
        holder.className = 'keiai-mermaid-svg';
        holder.innerHTML = svg;
        block.appendChild(holder);
        block.classList.add('is-rendered');
    }

    const observeTheme = onMermaidThemeChange(() => {
        if (destroyed || mermaidTheme === '' || mermaidTheme === currentTheme()) return;
        for (const block of node.querySelectorAll<HTMLElement>(MERMAID_SELECTOR)) {
            if (!block.classList.contains('is-rendered')) continue;
            block.classList.remove('is-rendered');
            block.querySelector('.keiai-mermaid-svg')?.remove();
        }
        scan();
    });

    scan();

    return {
        update(next: { html: string; generating: boolean }) {
            params = next;
            scan();
        },
        destroy() {
            destroyed = true;
            observeTheme();
        }
    };
};
