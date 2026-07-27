<script lang="ts">
    import { ImageOff } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import MediaGalleryDialog from '$lib/components/MediaGalleryDialog.svelte';
    import type { MediaGalleryItem } from '$lib/components/MediaGalleryDialog.svelte';
    import type { AssetReadLocator } from '$lib/services/asset';
    import { activeChat } from '$lib/stores';
    import { getAssetMediaType, type AssetMediaType } from '$lib/types/asset';

    let {
        ids,
        chatId,
        variant = 'inline',
        align = 'start'
    }: {
        ids: string[];
        chatId: string;
        variant?: 'inline' | 'attachment';
        align?: 'start' | 'end';
    } = $props();

    type InlayMedia = {
        id: string;
        name: string;
        mediaType: AssetMediaType;
        locator: AssetReadLocator | null;
    };

    let galleryOpen = $state(false);
    let selectedId = $state<string | undefined>();

    let media = $derived.by<InlayMedia[]>(() => {
        const chat = $activeChat;
        return ids.map((id) => {
            const ref = chat?.id === chatId ? chat.inlays.refs[id] : undefined;
            if (!ref || !chat) {
                return { id, name: 'Media unavailable', mediaType: 'other', locator: null };
            }
            return {
                id: ref.id,
                name: ref.name,
                mediaType: getAssetMediaType(ref.mimeType),
                locator: {
                    scopeType: chat.scopeType,
                    scopeId: chat.scopeId,
                    ownerTable: 'chats',
                    ownerId: chat.id,
                    hash: ref.hash,
                    encKey: ref.encKey,
                    mimeType: ref.mimeType
                }
            };
        });
    });

    let imageMedia = $derived(media.filter((item) => item.mediaType === 'image'));
    let audioMedia = $derived(media.filter((item) => item.mediaType === 'audio'));
    let unavailableMedia = $derived(media.filter((item) => !item.locator));

    let galleryItems = $derived<MediaGalleryItem[]>(
        media.flatMap((item) =>
            item.locator ? [{ id: item.id, name: item.name, asset: item.locator }] : []
        )
    );

    function openGallery(item: InlayMedia): void {
        if (!item.locator) return;
        selectedId = item.id;
        galleryOpen = true;
    }
</script>

{#if variant === 'attachment'}
    <div
        class="flex w-full max-w-2xl flex-col gap-2 py-1 {align === 'end'
            ? 'items-end'
            : 'items-start'}"
    >
        {#if imageMedia.length === 1}
            {@const item = imageMedia[0]}
            {#if item.locator}
                <button
                    type="button"
                    class="w-full max-w-xl cursor-zoom-in overflow-hidden rounded-lg border bg-muted/30 text-left transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-label={`Open ${item.name}`}
                    onclick={() => openGallery(item)}
                >
                    <AssetView
                        asset={item.locator}
                        alt={item.name}
                        class="w-full"
                        fallback="none"
                        mode="player"
                    />
                </button>
            {/if}
        {:else if imageMedia.length > 1}
            <div class="grid w-full max-w-2xl grid-cols-2 gap-2">
                {#each imageMedia as item (item.id)}
                    {#if item.locator}
                        <button
                            type="button"
                            class="aspect-square cursor-zoom-in overflow-hidden rounded-lg border bg-muted/30 text-left transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            aria-label={`Open ${item.name}`}
                            onclick={() => openGallery(item)}
                        >
                            <AssetView
                                asset={item.locator}
                                alt={item.name}
                                class="size-full"
                                fallback="none"
                                mode="thumbnail"
                            />
                        </button>
                    {/if}
                {/each}
            </div>
        {/if}

        {#each audioMedia as item (item.id)}
            {#if item.locator}
                <div class="w-full max-w-xl rounded-lg border bg-muted/30 px-3 py-2">
                    <div class="mb-1 truncate text-xs text-muted-foreground">{item.name}</div>
                    <AssetView
                        asset={item.locator}
                        alt={item.name}
                        class="w-full"
                        fallback="none"
                        mode="player"
                    />
                </div>
            {/if}
        {/each}

        {#each unavailableMedia as item (item.id)}
            <div
                class="flex h-20 w-full max-w-xl items-center justify-center rounded-lg border bg-muted text-muted-foreground"
                title={item.name}
                aria-label={item.name}
            >
                <ImageOff class="size-5" />
            </div>
        {/each}
    </div>
{:else}
    <div class="flex flex-wrap gap-2 py-1">
        {#each media as item (item.id)}
            <div class="size-24 overflow-hidden rounded-md border bg-muted">
                {#if item.locator}
                    <button
                        type="button"
                        class="size-full cursor-zoom-in text-left transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label={`Open ${item.name}`}
                        onclick={() => openGallery(item)}
                    >
                        <AssetView
                            asset={item.locator}
                            alt={item.name}
                            class="size-full"
                            fallback="none"
                            mode="thumbnail"
                        />
                    </button>
                {:else}
                    <div
                        class="flex size-full items-center justify-center text-muted-foreground"
                        title={item.name}
                        aria-label={item.name}
                    >
                        <ImageOff class="size-5" />
                    </div>
                {/if}
            </div>
        {/each}
    </div>
{/if}

<MediaGalleryDialog
    bind:open={galleryOpen}
    bind:selectedId
    items={galleryItems}
    title={variant === 'attachment' ? 'Message attachments' : 'Inlay media'}
/>
