<script lang="ts">
    import { Plus, User, Book, ImageIcon, FileText, Paperclip, X } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import MediaGalleryDialog from '$lib/components/MediaGalleryDialog.svelte';
    import type { MediaGalleryItem } from '$lib/components/MediaGalleryDialog.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import ParticipantCardMenu from '$lib/components/ParticipantCardMenu.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Badge } from '$lib/components/ui/badge';
    import { Label } from '$lib/components/ui/label';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import { Textarea } from '$lib/components/ui/textarea';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import {
        activeChat,
        chatPersonas,
        chatSelections,
        createChatFolder,
        saveChatLorebook,
        createChatInlay,
        deleteChatLorebook,
        deleteChatFolder,
        deleteChatInlay,
        removeChatPersona,
        setChatDefaultPersona,
        setChatSelectedPersona,
        moveChatItem,
        updateChatContent,
        updateChatFolder
    } from '$lib/stores';
    import { appConfirm, personaPickerOpen, toast } from '$lib/ui';
    import { navigateToPersonaStudio } from '$lib/managers';
    import { defaultLorebookFields, type ChatContent, type Lorebook } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import LorebookItem from '$lib/views/modules/LorebookItem.svelte';
    import { appDialog } from '$lib/adapters/dialog';
    import { getErrorMessage } from '$lib/types/errors';
    import { MEDIA_ASSET_EXTENSIONS } from '$lib/types/asset';
    import { generateSortOrder, listItems } from '$lib/utils/ordering';
    import { generateId } from '$lib/utils/id';

    interface Props {
        chatId: string;
        onSelectInlay?: (assetId: string) => void;
    }

    let { chatId, onSelectInlay }: Props = $props();

    let galleryVisible = $state(false);
    let panelAction = $state<string | null>(null);
    let galleryOpen = $state(false);
    let gallerySelectedId = $state<string | undefined>();
    let galleryItems = $derived.by<MediaGalleryItem[]>(() => {
        const chat = $activeChat;
        if (!chat) return [];
        return listItems(chat.inlays).map((ref) => ({
            id: ref.id,
            name: ref.name,
            asset: {
                scopeType: chat.scopeType,
                scopeId: chat.scopeId,
                ownerTable: 'chats',
                ownerId: chat.id,
                hash: ref.hash,
                encKey: ref.encKey,
                mimeType: ref.mimeType
            }
        }));
    });

    async function runPanelAction(
        key: string,
        errorTitle: string,
        action: () => void | Promise<unknown>
    ): Promise<boolean> {
        if (panelAction) return false;
        panelAction = key;
        try {
            await action();
            return true;
        } catch (error) {
            toast.error({ title: errorTitle, description: getErrorMessage(error) });
            return false;
        } finally {
            panelAction = null;
        }
    }

    async function updateChat(changes: DeepPartial<ChatContent>) {
        if (!$activeChat) return;
        await updateChatContent(chatId, changes);
    }

    function openGallery(ref: { id: string }): void {
        gallerySelectedId = ref.id;
        galleryOpen = true;
    }

    async function handleChatLorebookAdd() {
        if ($activeChat?.id !== chatId) return;
        await runPanelAction('add-lorebook', 'Could not add lorebook', async () => {
            const item: Lorebook = {
                ...defaultLorebookFields,
                depth: 0,
                id: generateId(),
                sortOrder: generateSortOrder(
                    $activeChat!.lorebooks.refs,
                    $activeChat!.lorebooks.folders
                )
            };
            await saveChatLorebook(chatId, item);
        });
    }

    function openPersonaSettings(personaId: string): void {
        void runPanelAction(`open-persona:${personaId}`, 'Could not open persona', () =>
            navigateToPersonaStudio(personaId)
        );
    }

    async function handleInlayUpload() {
        if ($activeChat?.id !== chatId) return;
        const targetChatId = chatId;
        await runPanelAction('upload-inlay', 'Could not upload gallery asset', async () => {
            const files = await appDialog.openMultipleFiles({
                title: 'Upload Gallery Asset',
                filters: [
                    {
                        name: 'Images, audio, and video',
                        extensions: [...MEDIA_ASSET_EXTENSIONS]
                    }
                ]
            });
            if (!files?.length || $activeChat?.id !== targetChatId) return;
            let uploadError: unknown;
            for (const file of files) {
                if ($activeChat?.id !== targetChatId) return;
                try {
                    await createChatInlay(targetChatId, file);
                } catch (error) {
                    uploadError ??= error;
                }
            }
            if (uploadError) throw uploadError;
        });
    }

    async function handleInlayDelete(assetId: string, name: string) {
        if ($activeChat?.id !== chatId) return;
        const targetChatId = chatId;
        await runPanelAction(
            `delete-inlay:${assetId}`,
            'Could not delete gallery image',
            async () => {
                const confirmed = await appConfirm({
                    title: 'Delete gallery image?',
                    description: `Delete "${name}"?`,
                    confirmText: 'Delete',
                    variant: 'destructive'
                });
                if (!confirmed || $activeChat?.id !== targetChatId) return;
                await deleteChatInlay(targetChatId, assetId);
            }
        );
    }

    async function handlePersonaSelect(personaId: string) {
        if ($activeChat?.id !== chatId) return;
        await runPanelAction(`select-persona:${personaId}`, 'Could not select persona', () =>
            setChatSelectedPersona(chatId, personaId)
        );
    }

    async function handleSetDefaultPersona(personaId: string) {
        if ($activeChat?.id !== chatId) return;
        await runPanelAction(`default-persona:${personaId}`, 'Could not set default persona', () =>
            setChatDefaultPersona(chatId, personaId)
        );
    }

    async function handlePersonaRemove(personaId: string) {
        if ($activeChat?.id !== chatId) return;
        const persona = $chatPersonas.find((item) => item.id === personaId);
        await runPanelAction(
            `remove-persona:${personaId}`,
            'Could not remove persona',
            async () => {
                const confirmed = await appConfirm({
                    title: 'Remove persona from chat?',
                    description: `Remove "${persona?.name ?? 'this persona'}" from this chat?`,
                    confirmText: 'Remove',
                    variant: 'destructive'
                });
                if (!confirmed || $activeChat?.id !== chatId) return;
                await removeChatPersona(chatId, personaId);
            }
        );
    }

    function initial(name: string): string {
        return (name.trim().charAt(0) || '?').toUpperCase();
    }
</script>

<div
    class="flex h-full flex-col border-l border-sidebar-border bg-sidebar"
    aria-busy={panelAction !== null}
>
    <!-- Panel Header -->
    <div
        class="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border bg-sidebar px-3"
    >
        <div class="min-w-0">
            <h2 class="text-sm font-semibold">Chat</h2>
            <p class="truncate text-[11px] text-muted-foreground">
                {$activeChat?.title ?? 'No chat selected'}
            </p>
        </div>
        <Button
            variant="ghost"
            size="icon-sm"
            class="shrink-0 {galleryVisible
                ? 'bg-sidebar-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
            title={galleryVisible ? 'Show chat context' : 'Show gallery'}
            aria-label={galleryVisible ? 'Show chat context' : 'Show gallery'}
            aria-pressed={galleryVisible}
            onclick={() => (galleryVisible = !galleryVisible)}
        >
            <ImageIcon class="size-4" />
        </Button>
    </div>

    <ScrollArea class="min-h-0 flex-1">
        <div class="pb-20">
            <!-- Persona Summary -->
            {#if $activeChat && !galleryVisible}
                <section class="space-y-2 border-b border-sidebar-border p-3">
                    <div class="flex items-center justify-between">
                        <Label
                            class="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground"
                        >
                            <User class="size-3" /> Personas
                        </Label>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            class="text-muted-foreground hover:text-foreground"
                            title="Add personas"
                            aria-label="Add personas"
                            disabled={panelAction !== null}
                            onclick={() => ($personaPickerOpen = true)}
                        >
                            <Plus class="size-3.5" />
                        </Button>
                    </div>
                    <EntityList
                        entities={$chatPersonas}
                        config={$activeChat.personas}
                        layout="grid"
                        gridClass="grid grid-cols-3 gap-2"
                        listClass="grid grid-cols-3 gap-2"
                        childContainerClass="relative my-1 px-2 py-1.5"
                        onItemClick={(persona) => {
                            void handlePersonaSelect(persona.id);
                        }}
                        onCreateFolder={(name, parentId, sortOrder) =>
                            createChatFolder(chatId, 'personas', name, parentId, sortOrder)}
                        onUpdateFolder={(id, changes) =>
                            updateChatFolder(chatId, 'personas', id, changes)}
                        onDeleteFolder={(id) => deleteChatFolder(chatId, 'personas', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveChatItem(chatId, 'personas', itemId, newFolderId, newSortOrder)}
                    >
                        {#snippet empty()}
                            <div class="col-span-3">
                                <EmptyListPlaceholder
                                    message="No personas attached to this chat."
                                />
                            </div>
                        {/snippet}
                        {#snippet item({ entity: persona })}
                            {@const selected = $chatSelections?.personaId === persona.id}
                            {@const isDefault = $activeChat.defaultPersonaId === persona.id}
                            <div class="group relative">
                                <div
                                    class="flex w-full min-w-0 cursor-pointer flex-col items-center gap-1 rounded-lg border border-foreground/15 bg-card p-2 text-center transition-[border-color,background-color] {selected
                                        ? 'border-primary ring-2 ring-primary/20'
                                        : 'hover:border-foreground/25 hover:bg-sidebar-accent'}"
                                    title={persona.name}
                                >
                                    <div
                                        class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-xs font-semibold"
                                    >
                                        {#if persona.avatar}
                                            <AssetView
                                                asset={{
                                                    scopeType: persona.scopeType,
                                                    scopeId: persona.scopeId,
                                                    ownerTable: 'personas',
                                                    ownerId: persona.id,
                                                    hash: persona.avatar.hash,
                                                    encKey: persona.avatar.encKey,
                                                    mimeType: persona.avatar.mimeType
                                                }}
                                                alt={persona.name}
                                                class="size-full object-cover"
                                            />
                                        {:else}
                                            {initial(persona.name)}
                                        {/if}
                                    </div>
                                    <span class="w-full truncate text-[11px]">{persona.name}</span>
                                </div>
                                <ParticipantCardMenu
                                    kind="persona"
                                    name={persona.name}
                                    {isDefault}
                                    disabled={panelAction !== null}
                                    defaultBusy={panelAction === `default-persona:${persona.id}`}
                                    removeBusy={panelAction === `remove-persona:${persona.id}`}
                                    onOpen={() => openPersonaSettings(persona.id)}
                                    onSetDefault={() => handleSetDefaultPersona(persona.id)}
                                    onRemove={() => handlePersonaRemove(persona.id)}
                                />
                            </div>
                        {/snippet}
                    </EntityList>
                </section>
            {/if}

            {#if !$activeChat}
                <div class="p-3 py-8 text-center text-xs text-muted-foreground">
                    Select a chat to view settings.
                </div>
            {:else if !galleryVisible}
                <!-- Chat Note -->
                <section class="space-y-2 border-b border-sidebar-border p-3">
                    <Label
                        for="chat-note"
                        class="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground"
                    >
                        <FileText class="size-3" /> Chat Note
                    </Label>
                    <Textarea
                        id="chat-note"
                        rows={4}
                        class="text-xs bg-background"
                        placeholder="Context specific to this conversation..."
                        value={$activeChat.chatNote}
                        oninput={(e) => updateChat({ chatNote: e.currentTarget.value })}
                    />
                </section>

                <!-- Active Lorebooks -->
                <section class="space-y-2 p-3">
                    <div class="flex items-center justify-between">
                        <Label
                            class="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground"
                        >
                            <Book class="size-3" /> Chat Lorebooks
                        </Label>
                        <div class="flex items-center gap-2">
                            <Badge variant="outline" class="text-[10px] font-mono"
                                >{listItems($activeChat.lorebooks).length}</Badge
                            >
                            <Button
                                variant="secondary"
                                size="icon-sm"
                                disabled={panelAction !== null}
                                aria-busy={panelAction === 'add-lorebook'}
                                aria-label="Add chat lorebook"
                                onclick={handleChatLorebookAdd}
                            >
                                <Plus class="size-3.5" />
                            </Button>
                        </div>
                    </div>

                    <EntityList
                        entities={listItems($activeChat.lorebooks)}
                        config={$activeChat.lorebooks}
                        layout="list"
                        onCreateFolder={(name, parentId, sortOrder) =>
                            createChatFolder(chatId, 'lorebooks', name, parentId, sortOrder)}
                        onUpdateFolder={(id, changes) =>
                            updateChatFolder(chatId, 'lorebooks', id, changes)}
                        onDeleteFolder={(id) => deleteChatFolder(chatId, 'lorebooks', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveChatItem(chatId, 'lorebooks', itemId, newFolderId, newSortOrder)}
                    >
                        {#snippet empty()}
                            <EmptyListPlaceholder message="No chat lorebooks." />
                        {/snippet}
                        {#snippet item({ entity: lb })}
                            <LorebookItem
                                item={lb}
                                onUpdate={(id, changes) =>
                                    saveChatLorebook(chatId, { ...lb, ...changes, id })}
                                onDelete={(id) => deleteChatLorebook(chatId, id)}
                            />
                        {/snippet}
                    </EntityList>
                </section>
            {:else}
                <!-- Runtime Assets (Inlays) -->
                <section class="space-y-1.5 p-3">
                    <div class="flex items-center justify-between">
                        <Label
                            class="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground"
                        >
                            <ImageIcon class="size-3" /> Gallery
                        </Label>
                        <div class="flex items-center gap-1.5">
                            <Badge variant="outline" class="text-[10px] font-mono"
                                >{Object.keys($activeChat?.inlays?.refs ?? {}).length}</Badge
                            >
                            <Button
                                variant="secondary"
                                size="icon-sm"
                                disabled={panelAction !== null}
                                aria-busy={panelAction === 'upload-inlay'}
                                aria-label="Upload gallery asset"
                                onclick={handleInlayUpload}
                            >
                                <Plus class="size-3" />
                            </Button>
                        </div>
                    </div>
                    <EntityList
                        entities={listItems($activeChat.inlays)}
                        config={$activeChat?.inlays ?? { refs: {}, folders: {} }}
                        layout="grid"
                        gridClass="grid grid-cols-3 gap-1 w-full"
                        itemWrapperClass={() =>
                            'relative w-full p-1 transition-all duration-200 drop-target'}
                        onCreateFolder={(name, parentId, sortOrder) =>
                            createChatFolder(chatId, 'inlays', name, parentId, sortOrder)}
                        onUpdateFolder={(id, changes) =>
                            updateChatFolder(chatId, 'inlays', id, changes)}
                        onDeleteFolder={(id) => deleteChatFolder(chatId, 'inlays', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveChatItem(chatId, 'inlays', itemId, newFolderId, newSortOrder)}
                        onItemClick={openGallery}
                    >
                        {#snippet empty()}
                            <div class="col-span-full">
                                <EmptyListPlaceholder message="No media assets." />
                            </div>
                        {/snippet}
                        {#snippet item({ entity: ref })}
                            {@const chat = $activeChat!}
                            <div
                                class="group relative aspect-square cursor-zoom-in overflow-visible rounded-lg"
                            >
                                <div class="absolute inset-0 overflow-hidden rounded-lg border">
                                    <AssetView
                                        asset={{
                                            scopeType: chat.scopeType,
                                            scopeId: chat.scopeId,
                                            ownerTable: 'chats',
                                            ownerId: chat.id,
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
                                    class="touch-visible absolute -left-1 -top-1 z-10 flex size-5 items-center justify-center rounded-full bg-background text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity after:absolute after:-inset-2 after:content-[''] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 focus-visible:opacity-100"
                                    title="Attach to message"
                                    aria-label={`Attach ${ref.name} to message`}
                                    onclick={(event) => {
                                        event.stopPropagation();
                                        onSelectInlay?.(ref.id);
                                    }}
                                >
                                    <Paperclip class="size-3" />
                                </button>
                                <button
                                    type="button"
                                    class="touch-visible absolute -right-1 -top-1 z-10 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 shadow-sm transition-opacity after:absolute after:-inset-2 after:content-[''] hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 focus-visible:opacity-100"
                                    title="Delete"
                                    aria-label={`Delete ${ref.name}`}
                                    disabled={panelAction !== null}
                                    aria-busy={panelAction === `delete-inlay:${ref.id}`}
                                    onclick={(event) => {
                                        event.stopPropagation();
                                        void handleInlayDelete(ref.id, ref.name);
                                    }}
                                >
                                    <X class="size-3" />
                                </button>
                            </div>
                        {/snippet}
                    </EntityList>
                </section>
            {/if}
        </div>
    </ScrollArea>
</div>

<MediaGalleryDialog
    bind:open={galleryOpen}
    bind:selectedId={gallerySelectedId}
    items={galleryItems}
    title="Chat gallery"
/>
