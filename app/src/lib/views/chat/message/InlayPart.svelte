<script lang="ts">
    import { ImageOff } from 'lucide-svelte';
    import MediaView from '$lib/components/MediaView.svelte';
    import AssetViewerDialog from '$lib/components/AssetViewerDialog.svelte';
    import type { AssetViewerItem } from '$lib/components/AssetViewerDialog.svelte';
    import type { AssetReadLocator } from '$lib/services/asset';
    import { activeChat, t } from '$lib/stores';
    import { getAssetMediaType, type AssetMediaType } from '$lib/types/asset';
    import { getFileIcon } from '$lib/components/fileDisplay';

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
        mimeType: string;
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
                return {
                    id,
                    name: $t('chat.message.inlay.unavailable'),
                    mimeType: '',
                    mediaType: 'other',
                    locator: null
                };
            }
            return {
                id: ref.id,
                name: ref.name,
                mimeType: ref.mimeType,
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

    let galleryItems = $derived<AssetViewerItem[]>(
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
                    title={$t('chat.message.inlay.open', { name: item.name })}
                    aria-label={$t('chat.message.inlay.open', { name: item.name })}
                    onclick={() => openGallery(item)}
                >
                    <MediaView
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
                            title={$t('chat.message.inlay.open', { name: item.name })}
                            aria-label={$t('chat.message.inlay.open', { name: item.name })}
                            onclick={() => openGallery(item)}
                        >
                            <MediaView
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
                    <MediaView
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
    <div class="flex flex-wrap items-center gap-2 py-1">
        {#each media as item (item.id)}
            {#if item.mediaType === 'other'}
                {@const FileIcon = getFileIcon(item.name, item.mimeType)}
                {#if item.locator}
                    <button
                        type="button"
                        class="flex h-14 min-w-36 max-w-xs shrink-0 cursor-zoom-in items-center gap-2.5 rounded-lg border bg-muted/40 px-3 py-2 text-left transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        title={$t('chat.message.inlay.open', { name: item.name })}
                        aria-label={$t('chat.message.inlay.open', { name: item.name })}
                        onclick={() => openGallery(item)}
                    >
                        <FileIcon class="size-5 shrink-0 text-muted-foreground" />
                        <span class="truncate text-xs font-medium text-foreground">
                            {item.name}
                        </span>
                    </button>
                {:else}
                    <div
                        class="flex h-14 min-w-36 max-w-xs shrink-0 items-center gap-2.5 rounded-lg border bg-muted/40 px-3 py-2 text-muted-foreground"
                        title={item.name}
                        aria-label={item.name}
                    >
                        <FileIcon class="size-5 shrink-0" />
                        <span class="truncate text-xs">{item.name}</span>
                    </div>
                {/if}
            {:else if item.locator}
                <button
                    type="button"
                    class="aspect-square size-20 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border bg-muted/40 text-left transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    title={$t('chat.message.inlay.open', { name: item.name })}
                    aria-label={$t('chat.message.inlay.open', { name: item.name })}
                    onclick={() => openGallery(item)}
                >
                    <MediaView
                        asset={item.locator}
                        alt={item.name}
                        class="size-full"
                        fallback="none"
                        mode="thumbnail"
                    />
                </button>
            {:else}
                <div
                    class="flex size-20 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground"
                    title={item.name}
                    aria-label={item.name}
                >
                    <ImageOff class="size-5" />
                </div>
            {/if}
        {/each}
    </div>
{/if}

<AssetViewerDialog
    bind:open={galleryOpen}
    bind:selectedId
    items={galleryItems}
    title={variant === 'attachment'
        ? $t('chat.message.attachmentsTitle')
        : $t('chat.message.inlayMediaTitle')}
/>
