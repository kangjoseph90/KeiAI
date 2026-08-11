<script lang="ts">
    import type { Snippet } from 'svelte';
    import {
        Plus,
        UserRoundPen,
        Book,
        ImageIcon,
        FileText,
        Paperclip,
        Pin,
        X
    } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import MediaEntityCard from '$lib/components/entitylist/MediaEntityCard.svelte';
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
        addChatDraftInlay,
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
        updateChatFolder,
        t
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
    import type { FolderDef } from '$lib/types/refs';

    interface Props {
        chatId: string;
    }

    interface PersonaFolderPayload {
        folder: FolderDef;
        collapsed: boolean;
        toggle: () => void;
        childCount: number;
        parts: {
            icon: Snippet<[{ folder: FolderDef; collapsed: boolean; sizeClass?: string }]>;
            name: Snippet<[{ folder: FolderDef }]>;
            actions: Snippet<[{ folder: FolderDef }]>;
        };
    }

    let { chatId }: Props = $props();

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
        await runPanelAction('add-lorebook', $t('chat.toast.addLorebook'), async () => {
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
        void runPanelAction(`open-persona:${personaId}`, $t('chat.toast.openPersona'), () =>
            navigateToPersonaStudio(personaId)
        );
    }

    async function handleInlayUpload() {
        if ($activeChat?.id !== chatId) return;
        const targetChatId = chatId;
        await runPanelAction('upload-inlay', $t('chat.toast.uploadGallery'), async () => {
            const files = await appDialog.openMultipleFiles({
                title: $t('chat.runtime.gallery.uploadTitle'),
                filters: [
                    {
                        name: $t('common.fileFilters.media'),
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
            $t('chat.toast.deleteGalleryImage'),
            async () => {
                const confirmed = await appConfirm({
                    title: $t('chat.runtime.gallery.delete'),
                    description: $t('library.room.deleteChatBody', { name }),
                    confirmText: $t('common.confirm.delete'),
                    variant: 'destructive'
                });
                if (!confirmed || $activeChat?.id !== targetChatId) return;
                await deleteChatInlay(targetChatId, assetId);
            }
        );
    }

    async function handlePersonaSelect(personaId: string) {
        if ($activeChat?.id !== chatId) return;
        await runPanelAction(`select-persona:${personaId}`, $t('chat.toast.selectPersona'), () =>
            setChatSelectedPersona(chatId, personaId)
        );
    }

    async function handleSetDefaultPersona(personaId: string) {
        if ($activeChat?.id !== chatId) return;
        await runPanelAction(
            `default-persona:${personaId}`,
            $t('chat.toast.setDefaultPersona'),
            () => setChatDefaultPersona(chatId, personaId)
        );
    }

    async function handlePersonaRemove(personaId: string) {
        if ($activeChat?.id !== chatId) return;
        const persona = $chatPersonas.find((item) => item.id === personaId);
        await runPanelAction(
            `remove-persona:${personaId}`,
            $t('chat.toast.removePersona'),
            async () => {
                const confirmed = await appConfirm({
                    title: $t('chat.personaPicker.title'),
                    description: $t('chat.runtime.personas.defaultHint', {
                        name: persona?.name ?? $t('chat.runtime.personas.default')
                    }),
                    confirmText: $t('common.confirm.remove'),
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

{#snippet personaFolder(payload: PersonaFolderPayload)}
    {@const { folder, collapsed, toggle, parts } = payload}
    {#snippet folderVisual()}
        {@render parts.icon({
            folder,
            collapsed,
            sizeClass: 'size-10 rounded-lg [&_svg]:size-4'
        })}
    {/snippet}
    {#snippet folderAction()}
        {@render parts.actions({ folder })}
    {/snippet}
    <div
        role="button"
        tabindex="0"
        aria-expanded={!collapsed}
        aria-label={folder.name}
        class="group/folder relative w-full cursor-pointer select-none"
        onclick={toggle}
        onkeydown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            toggle();
        }}
    >
        <MediaEntityCard
            name={folder.name}
            visual={folderVisual}
            action={folderAction}
            align="center"
            density="compact"
            interactive={false}
            footerClass="py-1"
            class="hover:border-foreground/25 hover:bg-sidebar-accent"
        />
    </div>
{/snippet}

<div
    class="chat-runtime-panel flex h-full flex-col border-l border-sidebar-border bg-sidebar"
    aria-busy={panelAction !== null}
>
    <!-- Panel Header -->
    <div
        class="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border bg-sidebar px-3"
    >
        <div class="min-w-0">
            <h2 class="text-sm font-semibold">{$t('chat.runtime.title')}</h2>
            <p class="truncate text-[11px] text-muted-foreground">
                {$activeChat?.title ?? $t('chat.runtime.noChat')}
            </p>
        </div>
        <Button
            variant="ghost"
            size="icon-sm"
            class="shrink-0 {galleryVisible
                ? 'bg-sidebar-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
            title={galleryVisible ? $t('chat.context.show') : $t('chat.runtime.gallery.title')}
            aria-label={galleryVisible ? $t('chat.context.show') : $t('chat.runtime.gallery.title')}
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
                            <UserRoundPen class="size-3" />
                            {$t('chat.runtime.section.personas')}
                        </Label>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            class="text-muted-foreground hover:text-foreground"
                            title={$t('chat.personaPicker.title')}
                            aria-label={$t('chat.personaPicker.title')}
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
                        gridClass="chat-runtime-persona-grid grid gap-2"
                        listClass="chat-runtime-persona-grid grid gap-2"
                        gridOverlapInset={0.18}
                        childContainerClass="relative my-2 rounded-xl border border-border/60 bg-muted/20 p-2"
                        folder={personaFolder}
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
                            <div class="col-span-full">
                                <EmptyListPlaceholder message={$t('chat.runtime.personas.empty')} />
                            </div>
                        {/snippet}
                        {#snippet item({ entity: persona })}
                            {@const selected = $chatSelections?.personaId === persona.id}
                            {@const isDefault = $activeChat.defaultPersonaId === persona.id}
                            {#snippet personaVisual()}
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
                                        focus="top"
                                    />
                                {:else}
                                    {initial(persona.name)}
                                {/if}
                            {/snippet}
                            {#snippet personaName()}
                                <span
                                    class="inline-flex max-w-full items-center justify-center gap-1"
                                >
                                    {#if isDefault}
                                        <span
                                            role="img"
                                            class="inline-flex size-3 shrink-0 items-center justify-center text-primary"
                                            title={$t('chat.runtime.personas.default')}
                                            aria-label={$t('chat.runtime.personas.defaultHint', {
                                                name: persona.name
                                            })}
                                        >
                                            <Pin class="size-3" />
                                        </span>
                                    {/if}
                                    <span class="truncate">{persona.name}</span>
                                </span>
                            {/snippet}
                            <div class="group relative">
                                <MediaEntityCard
                                    name={persona.name}
                                    visual={personaVisual}
                                    align="center"
                                    density="compact"
                                    interactive={false}
                                    nameContent={personaName}
                                    footerClass="py-1"
                                    class="cursor-pointer {selected
                                        ? 'border-primary ring-2 ring-primary/20'
                                        : 'hover:border-foreground/25 hover:bg-sidebar-accent'}"
                                />
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
                    {$t('chat.runtime.selectChat')}
                </div>
            {:else if !galleryVisible}
                <!-- Chat Note -->
                <section class="space-y-2 border-b border-sidebar-border p-3">
                    <Label
                        for="chat-note"
                        class="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground"
                    >
                        <FileText class="size-3" />
                        {$t('chat.runtime.section.chatNote')}
                    </Label>
                    <Textarea
                        id="chat-note"
                        rows={4}
                        class="text-xs bg-background"
                        placeholder={$t('chat.runtime.note.placeholder')}
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
                            <Book class="size-3" />
                            {$t('chat.runtime.section.lorebooks')}
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
                                aria-label={$t('chat.runtime.lorebooks.add')}
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
                            <EmptyListPlaceholder message={$t('chat.runtime.lorebooks.empty')} />
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
                            <ImageIcon class="size-3" />
                            {$t('chat.runtime.section.gallery')}
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
                                aria-label={$t('chat.runtime.gallery.upload')}
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
                        gridClass="chat-runtime-gallery-grid grid gap-1 w-full"
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
                                <EmptyListPlaceholder message={$t('chat.runtime.gallery.empty')} />
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
                                    title={$t('chat.runtime.gallery.attach')}
                                    aria-label={$t('chat.runtime.gallery.attachNamed', {
                                        name: ref.name
                                    })}
                                    onclick={(event) => {
                                        event.stopPropagation();
                                        if ($activeChat?.id === chatId) {
                                            addChatDraftInlay(chatId, ref.id);
                                        }
                                    }}
                                >
                                    <Paperclip class="size-3" />
                                </button>
                                <button
                                    type="button"
                                    class="touch-visible absolute -right-1 -top-1 z-10 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 shadow-sm transition-opacity after:absolute after:-inset-2 after:content-[''] hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 focus-visible:opacity-100"
                                    title={$t('chat.runtime.gallery.delete')}
                                    aria-label={$t('chat.runtime.gallery.deleteNamed', {
                                        name: ref.name
                                    })}
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
    title={$t('chat.runtime.gallery.title')}
/>

<style>
    .chat-runtime-panel {
        container: chat-runtime-panel / inline-size;
    }

    :global(.chat-runtime-persona-grid),
    :global(.chat-runtime-gallery-grid) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    @container chat-runtime-panel (min-width: 20rem) {
        :global(.chat-runtime-persona-grid),
        :global(.chat-runtime-gallery-grid) {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }
    }
</style>
