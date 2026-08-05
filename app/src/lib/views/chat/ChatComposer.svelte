<script lang="ts">
    import { ArrowDown, MessageSquare, Paperclip, SendHorizontal, Square, X } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import AutoResizeTextarea from '$lib/components/AutoResizeTextarea.svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import { activeChat, isChatRunning } from '$lib/stores';

    let {
        value = $bindable(''),
        attachmentIds = $bindable([]),
        maxAttachments,
        showScrollToBottom = false,
        overlayInert = false,
        onHeightChange,
        onSend,
        onGenerate,
        onStop,
        onUpload,
        onFiles,
        onScrollToBottom
    }: {
        value?: string;
        attachmentIds?: string[];
        maxAttachments: number;
        showScrollToBottom?: boolean;
        overlayInert?: boolean;
        onHeightChange: (height: number) => void;
        onSend: () => void;
        onGenerate: () => void;
        onStop: () => void;
        onUpload: () => void;
        onFiles: (files: File[]) => void;
        onScrollToBottom: () => void;
    } = $props();

    let composerElement = $state<HTMLElement>();
    let textHeight = $state(0);
    let dragCounter = $state(0);
    let previousChatId: string | undefined;

    const isExpanded = $derived(textHeight > 48);
    const hasContent = $derived(value.trim().length > 0 || attachmentIds.length > 0);
    const isDragging = $derived(dragCounter > 0);
    const pendingInlays = $derived.by(() => {
        if (!$activeChat) return [];
        return attachmentIds
            .map((attachmentId) => $activeChat?.inlays.refs[attachmentId])
            .filter((ref) => ref !== undefined);
    });

    $effect(() => {
        if (!composerElement) return;

        const updateHeight = () => {
            onHeightChange(Math.ceil(composerElement?.getBoundingClientRect().height ?? 0));
        };
        const observer = new ResizeObserver(updateHeight);
        observer.observe(composerElement);
        updateHeight();
        return () => observer.disconnect();
    });

    $effect(() => {
        const activeChatId = $activeChat?.id;
        if (activeChatId === previousChatId) return;
        previousChatId = activeChatId;
        dragCounter = 0;
    });

    function handlePaste(event: ClipboardEvent) {
        const files = filesFromPaste(event);
        if (files.length === 0) return;
        event.preventDefault();
        onFiles(files);
    }

    function handleDragEnter(event: DragEvent) {
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        dragCounter += 1;
    }

    function handleDragOver(event: DragEvent) {
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
    }

    function handleDragLeave(event: DragEvent) {
        event.preventDefault();
        dragCounter = Math.max(0, dragCounter - 1);
    }

    function handleDrop(event: DragEvent) {
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        dragCounter = 0;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length > 0) onFiles(files);
    }

    function filesFromPaste(event: ClipboardEvent): File[] {
        const data = event.clipboardData;
        if (!data) return [];
        const files = Array.from(data.files ?? []);
        if (files.length > 0) return files;
        return Array.from(data.items ?? []).flatMap((item) => {
            if (item.kind !== 'file') return [];
            const file = item.getAsFile();
            return file ? [file] : [];
        });
    }

    function hasDraggedFiles(event: DragEvent): boolean {
        const data = event.dataTransfer;
        if (!data) return false;
        return data.files.length > 0 || Array.from(data.types).includes('Files');
    }
</script>

<div
    role="region"
    aria-label="Message composer"
    inert={overlayInert}
    class="absolute inset-x-0 bottom-0 z-20 isolate px-3 pb-3 pt-1 md:px-4"
    ondragenter={handleDragEnter}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
>
    <div
        class="pointer-events-none absolute left-0 right-3.5 md:right-4 -top-8 bottom-0 -z-10 bg-gradient-to-b from-transparent via-background/45 to-background backdrop-blur-[1px] [mask-image:linear-gradient(to_bottom,transparent,black_62%)]"
        aria-hidden="true"
    ></div>

    {#if showScrollToBottom}
        <div class="absolute -top-12 left-1/2 z-20 -translate-x-1/2">
            <Button
                variant="secondary"
                size="icon"
                class="flex size-10 items-center justify-center rounded-full border bg-background/80 shadow-md backdrop-blur transition-opacity hover:bg-accent"
                onclick={onScrollToBottom}
                aria-label="Scroll to bottom"
            >
                <ArrowDown class="size-5" />
            </Button>
        </div>
    {/if}

    <div
        bind:this={composerElement}
        class="relative mx-auto w-full max-w-4xl rounded-[1.5rem] border border-border/80 bg-background/90 p-2 shadow-lg shadow-black/10 backdrop-blur-xl transition-[border-color,box-shadow] focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20"
    >
        {#if isDragging}
            <div
                class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[1.5rem] border-2 border-dashed border-primary/50 bg-background/95 text-sm font-medium text-primary backdrop-blur"
            >
                Drop images, audio, or video to attach
            </div>
        {/if}

        {#if pendingInlays.length > 0 && $activeChat}
            <div class="flex gap-2 overflow-x-auto px-2 pb-2 pt-1">
                {#each pendingInlays as ref (ref.id)}
                    <div class="relative size-18 shrink-0 overflow-visible rounded-lg">
                        <div class="absolute inset-0 overflow-hidden rounded-lg border">
                            <AssetView
                                asset={{
                                    scopeType: $activeChat.scopeType,
                                    scopeId: $activeChat.scopeId,
                                    ownerTable: 'chats',
                                    ownerId: $activeChat.id,
                                    hash: ref.hash,
                                    encKey: ref.encKey,
                                    mimeType: ref.mimeType
                                }}
                                alt={ref.name}
                                class="size-full object-cover"
                                fallback="none"
                            />
                        </div>
                        <button
                            type="button"
                            class="absolute -right-1 -top-1 z-10 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm"
                            aria-label={`Remove ${ref.name} attachment`}
                            onclick={() =>
                                (attachmentIds = attachmentIds.filter((id) => id !== ref.id))}
                        >
                            <X class="size-3" />
                        </button>
                    </div>
                {/each}
            </div>
        {/if}

        <div
            class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-1 {isExpanded
                ? 'items-end grid-rows-[auto_auto]'
                : 'items-center grid-rows-1'}"
        >
            <Button
                variant="ghost"
                size="icon"
                class="col-start-1 shrink-0 rounded-full text-muted-foreground {isExpanded
                    ? 'row-start-2'
                    : 'row-start-1'}"
                onclick={onUpload}
                disabled={$isChatRunning || attachmentIds.length >= maxAttachments}
                title="Attach media"
                aria-label="Attach media"
            >
                <Paperclip class="size-4" />
            </Button>

            <AutoResizeTextarea
                bind:value
                classname="min-h-9 min-w-0 border-0 bg-transparent px-2 py-2 shadow-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 {isExpanded
                    ? 'col-span-3 row-start-1 mx-2 w-auto'
                    : 'col-start-2 row-start-1'}"
                onheightchange={(height) => (textHeight = height)}
                onkeydown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        onSend();
                    }
                }}
                onpaste={handlePaste}
                placeholder="Type a message..."
                disabled={$isChatRunning}
            />

            {#if $isChatRunning}
                <Button
                    variant="destructive"
                    size="icon"
                    class="col-start-3 shrink-0 rounded-full {isExpanded
                        ? 'row-start-2'
                        : 'row-start-1'}"
                    onclick={onStop}
                    title="Stop generation"
                    aria-label="Stop generation"
                >
                    <Square class="size-4" />
                </Button>
            {:else if hasContent}
                <Button
                    size="icon"
                    class="col-start-3 shrink-0 rounded-full {isExpanded
                        ? 'row-start-2'
                        : 'row-start-1'}"
                    onclick={onSend}
                    title="Send message"
                    aria-label="Send message"
                >
                    <SendHorizontal class="size-4" />
                </Button>
            {:else}
                <Button
                    variant="secondary"
                    size="icon"
                    class="col-start-3 shrink-0 rounded-full {isExpanded
                        ? 'row-start-2'
                        : 'row-start-1'}"
                    onclick={onGenerate}
                    title="Generate response"
                    aria-label="Generate response"
                >
                    <MessageSquare class="size-4" />
                </Button>
            {/if}
        </div>
    </div>
</div>
