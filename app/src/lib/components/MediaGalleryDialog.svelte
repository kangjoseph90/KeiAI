<script module lang="ts">
    import type { AssetReadLocator } from '$lib/services/asset';

    export type MediaGalleryItem =
        | {
              id: string;
              name: string;
              asset: AssetReadLocator;
              src?: undefined;
              mimeType?: undefined;
          }
        | {
              id: string;
              name: string;
              src: string;
              mimeType?: string;
              asset?: undefined;
          };
</script>

<script lang="ts">
    import { AudioLines, ChevronLeft, ChevronRight, FileQuestion, Film } from 'lucide-svelte';
    import AssetView from './AssetView.svelte';
    import { Button } from '$lib/components/ui/button';
    import {
        Dialog,
        DialogContent,
        DialogDescription,
        DialogHeader,
        DialogTitle
    } from '$lib/components/ui/dialog';
    import { getAssetMediaType } from '$lib/types/asset';
    import { SvelteMap } from 'svelte/reactivity';

    let {
        open = $bindable(false),
        selectedId = $bindable<string | undefined>(),
        items,
        title = 'Asset gallery'
    }: {
        open?: boolean;
        selectedId?: string;
        items: MediaGalleryItem[];
        title?: string;
    } = $props();

    let currentIndex = $derived(getGalleryItemIndex(items, selectedId));
    let currentItem = $derived(currentIndex >= 0 ? items[currentIndex] : undefined);
    let showGalleryNavigation = $derived(items.length > 1);
    const thumbnailElements = new SvelteMap<string, HTMLButtonElement>();
    let mediaType = $derived(
        currentItem
            ? getAssetMediaType(currentItem.asset?.mimeType ?? currentItem.mimeType ?? 'image/*')
            : 'other'
    );

    function getGalleryItemIndex(
        items: readonly MediaGalleryItem[],
        selectedId: string | undefined
    ): number {
        return selectedId === undefined ? -1 : items.findIndex((item) => item.id === selectedId);
    }

    function getAdjacentGalleryItemId(
        items: readonly MediaGalleryItem[],
        selectedId: string | undefined,
        offset: number
    ): string | undefined {
        if (items.length === 0) return undefined;
        const currentIndex = getGalleryItemIndex(items, selectedId);
        if (currentIndex < 0) return items[0].id;
        const nextIndex = (currentIndex + offset + items.length) % items.length;
        return items[nextIndex].id;
    }

    $effect(() => {
        if (!open || items.length === 0 || currentIndex >= 0) return;
        selectedId = items[0].id;
    });

    $effect(() => {
        const id = selectedId;
        if (!open || !showGalleryNavigation || !id) return;
        thumbnailElements.get(id)?.scrollIntoView({
            behavior: 'auto',
            block: 'nearest',
            inline: 'center'
        });
    });

    function registerThumbnail(node: HTMLButtonElement, id: string): { destroy: () => void } {
        thumbnailElements.set(id, node);
        return {
            destroy: () => {
                thumbnailElements.delete(id);
            }
        };
    }

    function navigate(offset: number): void {
        selectedId = getAdjacentGalleryItemId(items, selectedId, offset);
    }

    function handleKeydown(event: KeyboardEvent): void {
        const target = event.target;
        if (
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLMediaElement
        ) {
            return;
        }
        if (!showGalleryNavigation) return;

        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            navigate(-1);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            navigate(1);
        } else if (event.key === 'Home' && items.length > 0) {
            event.preventDefault();
            selectedId = items[0].id;
        } else if (event.key === 'End' && items.length > 0) {
            event.preventDefault();
            selectedId = items[items.length - 1].id;
        }
    }
</script>

<Dialog bind:open>
    <DialogContent
        class="grid h-[min(90vh,56rem)] w-[calc(100%-2rem)] min-w-0 max-w-4xl gap-0 overflow-hidden p-0 sm:max-w-4xl {showGalleryNavigation
            ? 'grid-rows-[auto_minmax(0,1fr)_auto]'
            : 'grid-rows-[auto_minmax(0,1fr)]'}"
        onkeydown={handleKeydown}
    >
        <DialogHeader class="min-w-0 border-b px-5 py-4 pr-12 text-left">
            <DialogTitle class="truncate text-base">{currentItem?.name ?? title}</DialogTitle>
            <DialogDescription class="flex items-center gap-2 text-xs">
                <span>{title}</span>
                {#if currentItem}
                    <span aria-hidden="true">·</span>
                    <span class="font-mono"
                        >{currentItem.asset?.mimeType ??
                            currentItem.mimeType ??
                            'Unknown type'}</span
                    >
                {/if}
            </DialogDescription>
        </DialogHeader>

        <div class="relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden p-4">
            {#if currentItem}
                {#if mediaType === 'other'}
                    <div class="flex flex-col items-center gap-3 text-muted-foreground">
                        <FileQuestion class="size-12" />
                        <span class="text-sm">Preview unavailable</span>
                    </div>
                {:else if currentItem.asset}
                    <AssetView
                        asset={currentItem.asset}
                        alt={currentItem.name}
                        class={mediaType === 'audio'
                            ? 'min-w-0 w-full max-w-2xl overflow-visible'
                            : 'h-full min-h-0 min-w-0 w-full overflow-hidden'}
                        fallback="icon"
                        mode="player"
                    />
                {:else if currentItem.src}
                    {#if mediaType === 'audio'}
                        <audio
                            src={currentItem.src}
                            aria-label={currentItem.name}
                            class="w-full max-w-2xl"
                            controls
                            preload="metadata"
                        ></audio>
                    {:else if mediaType === 'video'}
                        <!-- svelte-ignore a11y_media_has_caption -->
                        <video
                            src={currentItem.src}
                            aria-label={currentItem.name}
                            class="block h-auto min-h-0 max-h-full w-auto min-w-0 max-w-full object-contain"
                            controls
                            preload="metadata"
                            playsinline
                        ></video>
                    {:else}
                        <img
                            src={currentItem.src}
                            alt={currentItem.name}
                            class="h-auto min-h-0 max-h-full w-auto min-w-0 max-w-full object-contain"
                            draggable="false"
                        />
                    {/if}
                {/if}
            {:else}
                <p class="text-sm text-muted-foreground">No assets to preview.</p>
            {/if}

            {#if showGalleryNavigation}
                <Button
                    variant="secondary"
                    size="icon"
                    tabindex={-1}
                    onmousedown={(e) => e.preventDefault()}
                    class="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full shadow-md focus:outline-none focus:ring-0 focus-visible:ring-0"
                    aria-label="Previous asset"
                    onclick={() => navigate(-1)}
                >
                    <ChevronLeft class="size-5" />
                </Button>
                <Button
                    variant="secondary"
                    size="icon"
                    tabindex={-1}
                    onmousedown={(e) => e.preventDefault()}
                    class="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full shadow-md focus:outline-none focus:ring-0 focus-visible:ring-0"
                    aria-label="Next asset"
                    onclick={() => navigate(1)}
                >
                    <ChevronRight class="size-5" />
                </Button>
            {/if}
        </div>

        {#if showGalleryNavigation}
            <div class="min-w-0 overflow-hidden">
                <div class="px-4 py-2 text-center text-xs text-muted-foreground">
                    {currentIndex >= 0 ? currentIndex + 1 : 0} / {items.length}
                </div>
                <div class="min-w-0 border-t px-4 py-3">
                    <div class="flex w-full min-w-0 max-w-full gap-2 overflow-x-auto pb-1">
                        {#each items as item (item.id)}
                            <button
                                use:registerThumbnail={item.id}
                                type="button"
                                tabindex={-1}
                                onmousedown={(e) => e.preventDefault()}
                                class="size-12 shrink-0 overflow-hidden rounded-md border bg-muted transition outline-none focus:outline-none focus:ring-0 focus-visible:ring-0 {item.id ===
                                currentItem?.id
                                    ? 'border-primary ring-2 ring-primary/20'
                                    : 'hover:border-foreground/30'}"
                                aria-label={`View ${item.name}`}
                                aria-current={item.id === currentItem?.id ? 'true' : undefined}
                                title={item.name}
                                onclick={() => (selectedId = item.id)}
                            >
                                {#if item.asset}
                                    <AssetView
                                        asset={item.asset}
                                        alt={item.name}
                                        class="size-full"
                                        fallback="icon"
                                        mode="thumbnail"
                                    />
                                {:else if item.src}
                                    {@const itemMediaType = getAssetMediaType(
                                        item.mimeType ?? 'image/*'
                                    )}
                                    {#if itemMediaType === 'audio'}
                                        <span
                                            class="flex size-full items-center justify-center text-muted-foreground"
                                        >
                                            <AudioLines class="size-5" />
                                        </span>
                                    {:else if itemMediaType === 'video'}
                                        <span
                                            class="flex size-full items-center justify-center text-muted-foreground"
                                        >
                                            <Film class="size-5" />
                                        </span>
                                    {:else}
                                        <img
                                            src={item.src}
                                            alt={item.name}
                                            class="size-full object-cover"
                                            draggable="false"
                                        />
                                    {/if}
                                {/if}
                            </button>
                        {/each}
                    </div>
                </div>
            </div>
        {/if}
    </DialogContent>
</Dialog>
