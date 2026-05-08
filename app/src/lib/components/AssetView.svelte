<script lang="ts">
    import { AssetService } from '$lib/services/asset';
    import { Loader2, FileQuestion } from 'lucide-svelte';
    import { cn } from '$lib/utils';
    import type { Action } from 'svelte/action';
    import { onDestroy } from 'svelte';

    let {
        id,
        alt = '',
        class: className = '',
        style = '',
        fallback = 'icon', // 'icon' | 'none'
        children
    }: {
        id: string | null | undefined;
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
    const MAX_RETRIES = 2;

    // ── Lazy visibility tracking ─────────────────────────────────────
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

    // ── Load only when visible + id is set ───────────────────────────
    function loadAsset(assetId: string) {
        loading = true;
        error = false;

        AssetService.read(assetId)
            .then((res) => {
                if (id !== assetId) {
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
                if (id !== assetId) return;
                setUrl(null);
                error = true;
            })
            .finally(() => {
                if (id === assetId) loading = false;
            });
    }

    $effect(() => {
        // Reset state immediately when ID changes
        setUrl(null);
        loading = false;
        error = false;
        retryCount = 0;

        if (!id) return;

        // Wait until the element is visible in the viewport
        if (!visible) return;

        loadAsset(id);
    });

    // ── Recovery: img onerror fires when a revoked URL breaks ────────
    function handleImgError() {
        if (!id || retryCount >= MAX_RETRIES) {
            setUrl(null);
            error = true;
            return;
        }
        retryCount++;
        loadAsset(id);
    }

    function setUrl(nextUrl: string | null): void {
        if (ownedUrl && ownedUrl !== nextUrl) {
            void AssetService.revokeUrl(ownedUrl);
        }
        ownedUrl = nextUrl;
        url = nextUrl;
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
    {:else if error || (!loading && !id)}
        {#if children}
            {@render children()}
        {:else if fallback === 'icon'}
            <div class="flex flex-col items-center justify-center gap-1 text-muted-foreground/50">
                <FileQuestion class="size-1/3" />
            </div>
        {/if}
    {/if}
</div>
