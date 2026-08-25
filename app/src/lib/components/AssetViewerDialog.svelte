<script module lang="ts">
    import type { AssetReadLocator } from '$lib/services/asset';

    export type AssetViewerItem =
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
    import {
        AudioLines,
        ChevronLeft,
        ChevronRight,
        Download,
        FileQuestion,
        Film,
        Loader2,
        X
    } from 'lucide-svelte';
    import MediaView from './MediaView.svelte';
    import { Button } from '$lib/components/ui/button';
    import {
        Dialog,
        DialogClose,
        DialogContent,
        DialogDescription,
        DialogHeader,
        DialogTitle
    } from '$lib/components/ui/dialog';
    import { getAssetMediaType, isTextAsset } from '$lib/types/asset';
    import { AssetService, type AssetUrlLease } from '$lib/services/asset';
    import { extractDocumentText, isOfficeDocument } from '$lib/utils/document';
    import { detectSyntaxLanguage, getFileIcon } from '$lib/components/fileDisplay';
    import { charsetFromMimeType, decodeTextBytes } from '$lib/utils/text';
    import SyntaxTextarea from '$lib/components/SyntaxTextarea.svelte';
    import { appDialog } from '$lib/adapters/dialog';
    import { SvelteMap } from 'svelte/reactivity';
    import { onDestroy } from 'svelte';
    import { t } from '$lib/stores';

    let {
        open = $bindable(false),
        selectedId = $bindable<string | undefined>(),
        items,
        title
    }: {
        open?: boolean;
        selectedId?: string;
        items: AssetViewerItem[];
        title?: string;
    } = $props();

    const resolvedTitle = $derived(title ?? $t('components.assetViewer.defaultTitle'));

    let currentIndex = $derived(getGalleryItemIndex(items, selectedId));
    let currentItem = $derived(currentIndex >= 0 ? items[currentIndex] : undefined);
    let showGalleryNavigation = $derived(items.length > 1);
    const thumbnailElements = new SvelteMap<string, HTMLButtonElement>();

    let mediaType = $derived(
        currentItem
            ? getAssetMediaType(currentItem.asset?.mimeType ?? currentItem.mimeType ?? 'image/*')
            : 'other'
    );

    let activeLease: AssetUrlLease | null = null;
    let activeBlobUrl: string | null = null;
    let fileLoading = $state(false);
    let fileError = $state(false);
    let fileKind = $state<'pdf' | 'text' | 'office' | 'unsupported'>('unsupported');
    let textContent = $state<string | null>(null);
    let pdfUrl = $state<string | null>(null);
    let loadRequestId = 0;

    function getGalleryItemIndex(
        itemList: readonly AssetViewerItem[],
        targetId: string | undefined
    ): number {
        return targetId === undefined ? -1 : itemList.findIndex((item) => item.id === targetId);
    }

    function getAdjacentGalleryItemId(
        itemList: readonly AssetViewerItem[],
        targetId: string | undefined,
        offset: number
    ): string | undefined {
        if (itemList.length === 0) return undefined;
        const current = getGalleryItemIndex(itemList, targetId);
        if (current < 0) return itemList[0].id;
        const next = (current + offset + itemList.length) % itemList.length;
        return itemList[next].id;
    }

    function cleanupResources(): void {
        if (activeLease) {
            void activeLease.release();
            activeLease = null;
        }
        if (activeBlobUrl) {
            URL.revokeObjectURL(activeBlobUrl);
            activeBlobUrl = null;
        }
        pdfUrl = null;
        textContent = null;
        fileLoading = false;
        fileError = false;
    }

    async function loadItemBytes(item: AssetViewerItem): Promise<Uint8Array | null> {
        if (item.asset) {
            const loaded = await AssetService.load(item.asset);
            if (!loaded) return null;
            return AssetService.readBytes(item.asset);
        }
        if (item.src) {
            const response = await fetch(item.src);
            if (!response.ok) return null;
            return new Uint8Array(await response.arrayBuffer());
        }
        return null;
    }

    function resolveItemMimeType(item: AssetViewerItem): string {
        return (item.asset?.mimeType ?? item.mimeType ?? 'application/octet-stream')
            .trim()
            .toLowerCase()
            .split(';', 1)[0];
    }

    async function loadFileContent(item: AssetViewerItem, reqId: number): Promise<void> {
        const mimeType = resolveItemMimeType(item);
        const fileName = item.name;
        const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');

        if (isPdf) {
            fileKind = 'pdf';
            if (item.asset) {
                const lease = await AssetService.acquireUrl(item.asset);
                if (reqId !== loadRequestId) {
                    if (lease) void lease.release();
                    return;
                }
                if (lease) {
                    activeLease = lease;
                    pdfUrl = lease.url;
                } else {
                    fileError = true;
                }
            } else if (item.src) {
                pdfUrl = item.src;
            }
            return;
        }

        const bytes = await loadItemBytes(item);
        if (reqId !== loadRequestId) return;
        if (!bytes) {
            fileError = true;
            fileKind = 'unsupported';
            return;
        }

        if (isOfficeDocument(mimeType, fileName)) {
            const officeText = extractDocumentText(bytes, mimeType, fileName);
            if (reqId !== loadRequestId) return;
            if (officeText !== null) {
                fileKind = 'office';
                textContent = officeText;
                return;
            }
        }

        if (isTextAsset(fileName, mimeType)) {
            fileKind = 'text';
            let decoded = decodeTextBytes(
                bytes,
                charsetFromMimeType(item.asset?.mimeType ?? item.mimeType)
            );
            if (
                mimeType === 'application/json' ||
                fileName.toLowerCase().endsWith('.json') ||
                fileName.toLowerCase().endsWith('.keipreset')
            ) {
                try {
                    decoded = JSON.stringify(JSON.parse(decoded), null, 2);
                } catch {
                    // Keep unformatted text on parse error
                }
            }
            textContent = decoded;
            return;
        }

        // Try decoding general text as a fallback if no NUL bytes in initial snippet
        const snippet = bytes.subarray(0, 1024);
        const hasNullByte = snippet.some((b) => b === 0);
        if (!hasNullByte) {
            const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
            fileKind = 'text';
            textContent = decoded;
            return;
        }

        fileKind = 'unsupported';
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

    $effect(() => {
        const item = currentItem;
        const isDialogOpen = open;

        cleanupResources();
        const currentReqId = ++loadRequestId;

        if (!isDialogOpen || !item || mediaType !== 'other') {
            return;
        }

        fileLoading = true;
        fileError = false;

        void loadFileContent(item, currentReqId)
            .catch(() => {
                if (currentReqId === loadRequestId) {
                    fileError = true;
                    fileKind = 'unsupported';
                }
            })
            .finally(() => {
                if (currentReqId === loadRequestId) {
                    fileLoading = false;
                }
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

    async function handleDownload(): Promise<void> {
        if (!currentItem) return;
        const item = currentItem;
        const bytes = await loadItemBytes(item);
        if (!bytes) return;

        await appDialog.saveBytes({
            bytes,
            fileName: item.name,
            mimeType: item.asset?.mimeType ?? item.mimeType ?? 'application/octet-stream'
        });
    }

    onDestroy(() => {
        cleanupResources();
    });
</script>

<Dialog bind:open>
    <DialogContent
        showCloseButton={false}
        class="grid h-[min(90vh,56rem)] w-[calc(100%-2rem)] min-w-0 max-w-4xl gap-0 overflow-hidden p-0 sm:max-w-4xl {showGalleryNavigation
            ? 'grid-rows-[auto_minmax(0,1fr)_auto]'
            : 'grid-rows-[auto_minmax(0,1fr)]'}"
        onkeydown={handleKeydown}
    >
        <DialogHeader class="min-w-0 border-b px-5 py-4 text-left">
            <div class="flex items-center justify-between gap-3">
                <div class="min-w-0 flex-1">
                    <DialogTitle class="truncate text-base">
                        {currentItem?.name ?? resolvedTitle}
                    </DialogTitle>
                    <DialogDescription class="flex items-center gap-2 text-xs">
                        <span>{resolvedTitle}</span>
                        {#if currentItem}
                            <span aria-hidden="true">·</span>
                            <span class="font-mono">
                                {currentItem.asset?.mimeType ??
                                    currentItem.mimeType ??
                                    $t('components.assetViewer.unknownType')}
                            </span>
                        {/if}
                    </DialogDescription>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                    {#if currentItem}
                        <Button
                            variant="ghost"
                            size="icon"
                            class="size-9 text-muted-foreground hover:text-foreground"
                            title={$t('components.assetViewer.download', {
                                name: currentItem.name
                            })}
                            aria-label={$t('components.assetViewer.download', {
                                name: currentItem.name
                            })}
                            onclick={handleDownload}
                        >
                            <Download class="size-4" />
                        </Button>
                    {/if}
                    <DialogClose
                        class="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        aria-label={$t('common.actions.close')}
                    >
                        <X class="size-5" />
                    </DialogClose>
                </div>
            </div>
        </DialogHeader>

        <div
            class="grid min-h-0 min-w-0 overflow-hidden {showGalleryNavigation
                ? 'grid-cols-1 sm:grid-cols-[3rem_minmax(0,1fr)_3rem]'
                : 'grid-cols-1'}"
        >
            <div
                class="row-start-1 flex min-h-0 min-w-0 items-center justify-center overflow-hidden p-4 {showGalleryNavigation
                    ? 'col-start-1 pb-2 sm:col-start-2'
                    : 'col-start-1'}"
            >
                {#if currentItem}
                    {#if mediaType === 'other'}
                        {#if fileLoading}
                            <div class="flex flex-col items-center gap-3 text-muted-foreground">
                                <Loader2 class="size-8 animate-spin" />
                                <span class="text-sm">{$t('components.assetViewer.loading')}</span>
                            </div>
                        {:else if fileKind === 'pdf' && pdfUrl}
                            <iframe
                                src={pdfUrl}
                                title={currentItem.name}
                                class="size-full rounded-md border-0 bg-background"
                            ></iframe>
                        {:else if (fileKind === 'text' || fileKind === 'office') && textContent !== null}
                            {@const language =
                                fileKind === 'office'
                                    ? 'none'
                                    : detectSyntaxLanguage(
                                          currentItem.name,
                                          currentItem.asset?.mimeType ?? currentItem.mimeType
                                      )}
                            {@const showLineNumbers = fileKind === 'text' && language !== 'none'}
                            <div
                                class="size-full min-h-0 overflow-hidden rounded-md border bg-muted/20"
                            >
                                <SyntaxTextarea
                                    value={textContent}
                                    readonly={true}
                                    {language}
                                    {showLineNumbers}
                                    maxHeight={Infinity}
                                    class="size-full rounded-none border-0 bg-transparent shadow-none dark:bg-transparent"
                                />
                            </div>
                        {:else}
                            <div class="flex flex-col items-center gap-4 text-center">
                                <div
                                    class="flex size-16 items-center justify-center rounded-2xl border bg-muted/40 text-muted-foreground shadow-xs"
                                >
                                    <FileQuestion class="size-8" />
                                </div>
                                <div class="space-y-1">
                                    <p class="text-sm font-medium text-foreground">
                                        {currentItem.name}
                                    </p>
                                    <p class="text-xs text-muted-foreground">
                                        {$t('components.assetViewer.previewUnavailable')}
                                    </p>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    class="gap-2"
                                    onclick={handleDownload}
                                >
                                    <Download class="size-3.5" />
                                    <span>{$t('common.actions.download')}</span>
                                </Button>
                            </div>
                        {/if}
                    {:else if currentItem.asset}
                        <MediaView
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
                    <p class="text-sm text-muted-foreground">
                        {$t('components.assetViewer.empty')}
                    </p>
                {/if}
            </div>

            {#if showGalleryNavigation}
                <Button
                    variant="secondary"
                    size="icon"
                    tabindex={-1}
                    onmousedown={(e) => e.preventDefault()}
                    class="col-start-1 row-start-1 hidden self-center justify-self-center rounded-full shadow-md focus:outline-none focus:ring-0 focus-visible:ring-0 sm:inline-flex"
                    aria-label={$t('components.assetViewer.previous')}
                    onclick={() => navigate(-1)}
                >
                    <ChevronLeft class="size-5" />
                </Button>
                <Button
                    variant="secondary"
                    size="icon"
                    tabindex={-1}
                    onmousedown={(e) => e.preventDefault()}
                    class="col-start-3 row-start-1 hidden self-center justify-self-center rounded-full shadow-md focus:outline-none focus:ring-0 focus-visible:ring-0 sm:inline-flex"
                    aria-label={$t('components.assetViewer.next')}
                    onclick={() => navigate(1)}
                >
                    <ChevronRight class="size-5" />
                </Button>
            {/if}
        </div>

        {#if showGalleryNavigation}
            <div class="min-w-0 overflow-hidden">
                <div
                    class="flex items-center justify-center gap-3 px-4 pt-1 pb-2 text-xs text-muted-foreground"
                >
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        class="sm:hidden"
                        aria-label={$t('components.assetViewer.previous')}
                        onclick={() => navigate(-1)}
                    >
                        <ChevronLeft class="size-4" />
                    </Button>
                    <span>{currentIndex >= 0 ? currentIndex + 1 : 0} / {items.length}</span>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        class="sm:hidden"
                        aria-label={$t('components.assetViewer.next')}
                        onclick={() => navigate(1)}
                    >
                        <ChevronRight class="size-4" />
                    </Button>
                </div>
                <div class="min-w-0 border-t px-4 py-2.5">
                    <div class="flex w-full min-w-0 max-w-full gap-2 overflow-x-auto pb-1">
                        {#each items as item (item.id)}
                            {@const itemMediaType = getAssetMediaType(
                                item.asset?.mimeType ?? item.mimeType ?? 'image/*'
                            )}
                            <button
                                use:registerThumbnail={item.id}
                                type="button"
                                tabindex={-1}
                                onmousedown={(e) => e.preventDefault()}
                                class="size-12 shrink-0 overflow-hidden rounded-md border bg-muted transition outline-none focus:outline-none focus:ring-0 focus-visible:ring-0 {item.id ===
                                currentItem?.id
                                    ? 'border-primary ring-2 ring-primary/20'
                                    : 'hover:border-foreground/30'}"
                                aria-label={$t('components.assetViewer.view', { name: item.name })}
                                aria-current={item.id === currentItem?.id ? 'true' : undefined}
                                title={item.name}
                                onclick={() => (selectedId = item.id)}
                            >
                                {#if itemMediaType === 'other'}
                                    {@const IconComponent = getFileIcon(
                                        item.name,
                                        item.asset?.mimeType ?? item.mimeType
                                    )}
                                    <span
                                        class="flex size-full flex-col items-center justify-center gap-0.5 bg-muted/40 p-1 text-muted-foreground"
                                    >
                                        <IconComponent class="size-4" />
                                        <span
                                            class="max-w-full truncate text-[8px] font-mono leading-none"
                                        >
                                            {item.name.split('.').pop()?.toUpperCase() ?? 'FILE'}
                                        </span>
                                    </span>
                                {:else if itemMediaType === 'audio'}
                                    <span
                                        class="flex size-full flex-col items-center justify-center gap-0.5 bg-muted/40 p-1 text-muted-foreground"
                                    >
                                        <AudioLines class="size-4" />
                                        <span
                                            class="max-w-full truncate text-[8px] font-mono leading-none"
                                        >
                                            {item.name.split('.').pop()?.toUpperCase() ?? 'AUDIO'}
                                        </span>
                                    </span>
                                {:else if itemMediaType === 'video'}
                                    <span
                                        class="flex size-full flex-col items-center justify-center gap-0.5 bg-muted/40 p-1 text-muted-foreground"
                                    >
                                        <Film class="size-4" />
                                        <span
                                            class="max-w-full truncate text-[8px] font-mono leading-none"
                                        >
                                            {item.name.split('.').pop()?.toUpperCase() ?? 'VIDEO'}
                                        </span>
                                    </span>
                                {:else if item.asset}
                                    <MediaView
                                        asset={item.asset}
                                        alt={item.name}
                                        class="size-full"
                                        fallback="icon"
                                        mode="thumbnail"
                                    />
                                {:else if item.src}
                                    <img
                                        src={item.src}
                                        alt={item.name}
                                        class="size-full object-cover"
                                        draggable="false"
                                    />
                                {/if}
                            </button>
                        {/each}
                    </div>
                </div>
            </div>
        {/if}
    </DialogContent>
</Dialog>
