<script lang="ts">
    import { assetRegistryId } from '$lib/adapters/asset';
    import { AssetService, type AssetReadLocator, type AssetUrlLease } from '$lib/services/asset';
    import { AudioLines, FileQuestion, Film, Loader2 } from 'lucide-svelte';
    import { cn } from '$lib/utils';
    import type { Action } from 'svelte/action';
    import { onDestroy } from 'svelte';
    import { getAssetMediaType } from '$lib/types/asset';

    let {
        asset,
        alt = '',
        class: className = '',
        style = '',
        fallback = 'icon', // 'icon' | 'none'
        mode = 'thumbnail',
        children
    }: {
        asset: AssetReadLocator | null | undefined;
        alt?: string;
        class?: string;
        style?: string;
        fallback?: 'icon' | 'none';
        mode?: 'thumbnail' | 'player';
        children?: import('svelte').Snippet;
    } = $props();

    let url = $state<string | null>(null);
    let loading = $state(false);
    let error = $state(false);
    let visible = $state(false);
    let retryCount = 0;
    let ownedLease: AssetUrlLease | null = null;
    let requestedAssetKey: string | null = null;
    let requestGeneration = 0;
    let destroyed = false;
    const MAX_RETRIES = 2;
    let mediaType = $derived(asset?.mimeType ? getAssetMediaType(asset.mimeType) : 'image');

    // Lazy visibility tracking
    const observeVisibility: Action = (node) => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    visible = true;
                }
            },
            { rootMargin: '1000px' }
        );
        observer.observe(node);
        return {
            destroy() {
                observer.disconnect();
            }
        };
    };

    // Load only when visible + asset is set
    function loadAsset(locator: AssetReadLocator) {
        const key = assetRegistryId(locator);
        const generation = ++requestGeneration;
        requestedAssetKey = key;
        loading = true;
        error = false;

        AssetService.acquireUrl(locator)
            .then((lease) => {
                if (destroyed || generation !== requestGeneration || currentAssetKey() !== key) {
                    if (lease) void lease.release();
                    return;
                }
                if (lease) {
                    setLease(lease);
                    error = false;
                } else {
                    setLease(null);
                    error = true;
                }
            })
            .catch(() => {
                if (destroyed || generation !== requestGeneration || currentAssetKey() !== key)
                    return;
                setLease(null);
                error = true;
            })
            .finally(() => {
                if (!destroyed && generation === requestGeneration && currentAssetKey() === key)
                    loading = false;
            });
    }

    $effect(() => {
        const locator = asset ?? null;
        const key = currentAssetKey();

        if (!locator || !key) {
            requestedAssetKey = null;
            resetAssetState();
            return;
        }

        // Wait until the element is visible in the viewport
        if (!visible) return;

        // Audio/video tiles are metadata-only previews. Avoid downloading a
        // potentially large media blob until a player is explicitly opened.
        if (mode === 'thumbnail' && (mediaType === 'audio' || mediaType === 'video')) {
            requestedAssetKey = null;
            resetAssetState();
            return;
        }

        if (requestedAssetKey === key) return;

        resetAssetState();
        loadAsset(locator);
    });

    // Recovery: img onerror fires when a revoked URL breaks
    function handleMediaError() {
        setLease(null);
        if (!asset || retryCount >= MAX_RETRIES) {
            error = true;
            return;
        }
        retryCount++;
        loadAsset(asset);
    }

    function currentAssetKey(): string | null {
        return asset ? assetRegistryId(asset) : null;
    }

    function setLease(nextLease: AssetUrlLease | null): void {
        if (ownedLease && ownedLease !== nextLease) {
            void ownedLease.release();
        }
        ownedLease = nextLease;
        url = nextLease?.url ?? null;
    }

    function resetAssetState(): void {
        requestGeneration += 1;
        setLease(null);
        loading = false;
        error = false;
        retryCount = 0;
    }

    onDestroy(() => {
        destroyed = true;
        requestGeneration += 1;
        setLease(null);
    });
</script>

<div
    class={cn('relative flex items-center justify-center overflow-hidden', className)}
    {style}
    use:observeVisibility
>
    {#if loading}
        <div class="absolute inset-0 flex items-center justify-center bg-muted/50 animate-pulse">
            <Loader2 class="size-4 animate-spin text-muted-foreground" />
        </div>
    {/if}

    {#if mode === 'thumbnail' && mediaType === 'audio'}
        <div
            class="flex size-full items-center justify-center bg-muted text-muted-foreground"
            title={alt}
            aria-label={alt}
        >
            <AudioLines class="size-1/3 min-h-5 min-w-5" />
        </div>
    {:else if mode === 'thumbnail' && mediaType === 'video'}
        <div
            class="flex size-full items-center justify-center bg-muted text-muted-foreground"
            title={alt}
            aria-label={alt}
        >
            <Film class="size-1/3 min-h-5 min-w-5" />
        </div>
    {:else if url}
        {#if mediaType === 'audio'}
            <audio
                src={url}
                aria-label={alt}
                class="w-full"
                controls
                preload="metadata"
                onerror={handleMediaError}
            ></audio>
        {:else if mediaType === 'video'}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video
                src={url}
                aria-label={alt}
                class="block h-auto min-h-0 max-h-full w-auto min-w-0 max-w-full object-contain"
                controls
                preload="metadata"
                playsinline
                onerror={handleMediaError}
            ></video>
        {:else}
            <img
                src={url}
                {alt}
                class={mode === 'player'
                    ? 'h-auto max-h-full w-auto max-w-full object-contain'
                    : 'size-full object-cover'}
                onerror={handleMediaError}
                draggable="false"
            />
        {/if}
    {:else if error || (!loading && !asset)}
        {#if children}
            {@render children()}
        {:else if fallback === 'icon'}
            <div class="flex flex-col items-center justify-center gap-1 text-muted-foreground/50">
                <FileQuestion class="size-1/3" />
            </div>
        {/if}
    {/if}
</div>
