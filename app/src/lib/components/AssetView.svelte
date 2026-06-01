<script lang="ts">
    import { assetRegistryId } from '$lib/adapters/asset';
    import { AssetService, type AssetReadLocator } from '$lib/services/asset';
    import { Loader2, FileQuestion } from 'lucide-svelte';
    import { cn } from '$lib/utils';
    import type { Action } from 'svelte/action';
    import { onDestroy } from 'svelte';

    let {
        asset,
        alt = '',
        class: className = '',
        style = '',
        fallback = 'icon', // 'icon' | 'none'
        children
    }: {
        asset: AssetReadLocator | null | undefined;
        alt?: string;
        class?: string;
        style?: string;
        fallback?: 'icon' | 'none';
        children?: import('svelte').Snippet;
    } = $props();

    let url = $state<string | null>(null);
    let loading = $state(false);
    let error = $state(false);
    let visible = $state(false);
    let retryCount = 0;
    let ownedUrl: string | null = null;
    let requestedAssetKey: string | null = null;
    const MAX_RETRIES = 2;

    // Lazy visibility tracking
    const observeVisibility: Action = (node) => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    visible = true;
                }
            },
            { rootMargin: '200px' }
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
        requestedAssetKey = key;
        loading = true;
        error = false;

        AssetService.read(locator)
            .then((res) => {
                if (currentAssetKey() !== key) {
                    if (res) void AssetService.revokeUrl(res);
                    return;
                }
                if (res) {
                    setUrl(res);
                    error = false;
                    retryCount = 0;
                } else {
                    setUrl(null);
                    error = true;
                }
            })
            .catch(() => {
                if (currentAssetKey() !== key) return;
                setUrl(null);
                error = true;
            })
            .finally(() => {
                if (currentAssetKey() === key) loading = false;
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

        if (requestedAssetKey === key) return;

        resetAssetState();
        loadAsset(locator);
    });

    // Recovery: img onerror fires when a revoked URL breaks
    function handleImgError() {
        setUrl(null);
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

    function setUrl(nextUrl: string | null): void {
        if (ownedUrl && ownedUrl !== nextUrl) {
            void AssetService.revokeUrl(ownedUrl);
        }
        ownedUrl = nextUrl;
        url = nextUrl;
    }

    function resetAssetState(): void {
        setUrl(null);
        loading = false;
        error = false;
        retryCount = 0;
    }

    onDestroy(() => {
        setUrl(null);
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

    {#if url}
        <img src={url} {alt} class="size-full object-cover" onerror={handleImgError} />
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
