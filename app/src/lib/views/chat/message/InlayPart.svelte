<script lang="ts">
    import { ImageOff } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import MediaGalleryDialog from '$lib/components/MediaGalleryDialog.svelte';
    import type { MediaGalleryItem } from '$lib/components/MediaGalleryDialog.svelte';
    import type { AssetReadLocator } from '$lib/services/asset';
    import { activeChat } from '$lib/stores';

    let {
        ids,
        chatId
    }: {
        ids: string[];
        chatId: string;
    } = $props();

    type InlayMedia = {
        id: string;
        name: string;
        locator: AssetReadLocator | null;
    };

    let galleryOpen = $state(false);
    let selectedId = $state<string | undefined>();

    let media = $derived.by<InlayMedia[]>(() => {
        const chat = $activeChat;
        return ids.map((id) => {
            const ref = chat?.id === chatId ? chat.inlays.refs[id] : undefined;
            if (!ref || !chat) {
                return { id, name: 'Media unavailable', locator: null };
            }
            return {
                id: ref.id,
                name: ref.name,
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

<MediaGalleryDialog
    bind:open={galleryOpen}
    bind:selectedId
    items={galleryItems}
    title="Inlay media"
/>
