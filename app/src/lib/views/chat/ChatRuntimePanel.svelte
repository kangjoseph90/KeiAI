<script lang="ts">
    import {
        Pin,
        Plus,
        User,
        Settings,
        Book,
        Variable,
        ImageIcon,
        FileText,
        Paperclip,
        X
    } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import MediaGalleryDialog from '$lib/components/MediaGalleryDialog.svelte';
    import type { MediaGalleryItem } from '$lib/components/MediaGalleryDialog.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import KeyValueEditor from '$lib/components/KeyValueEditor.svelte';
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
        messages,
        removeChatPersona,
        setChatDefaultPersona,
        setChatSelectedPersona,
        moveChatItem,
        updateChatContent,
        updateChatFolder
    } from '$lib/stores';
    import { appConfirm, personaPickerOpen, toast } from '$lib/ui';
    import { getChatVariables, navigateToPersonaStudio, setChatVariables } from '$lib/managers';
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

    let variables = $state<Record<string, string>>({});
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

    $effect(() => {
        if (chatId) {
            getChatVariables(chatId).then((v) => {
                variables = v;
            });
        } else {
            variables = {};
        }
    });

    async function persistVariables(next: Record<string, string>): Promise<boolean> {
        if ($messages.length === 0) return false;

        const previous = variables;
        variables = next;
        try {
            await setChatVariables(chatId, next);
            return true;
        } catch (error) {
            variables = previous;
            toast.error({
                title: 'Could not update chat variables',
                description: getErrorMessage(error)
            });
            return false;
        }
    }

    async function handleVariableUpdate(key: string, value: string): Promise<void> {
        await persistVariables({ ...variables, [key]: value });
    }

    function handleVariableAdd(key: string, value: string): Promise<boolean> {
        return persistVariables({ ...variables, [key]: value });
    }

    async function handleVariableRemove(key: string): Promise<void> {
        const next = { ...variables };
        delete next[key];
        await persistVariables(next);
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
            <h2 class="text-sm font-semibold">Chat context</h2>
            <p class="truncate text-[11px] text-muted-foreground">
                {$activeChat?.title ?? 'No chat selected'}
            </p>
        </div>
    </div>

    <ScrollArea class="min-h-0 flex-1">
        <div class="pb-20">
            <!-- Persona Summary -->
            {#if $activeChat}
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
                            class="size-6 text-muted-foreground hover:text-foreground"
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
                                    class="flex w-full min-w-0 flex-col items-center gap-1 rounded-md border bg-background p-2 text-center transition-colors cursor-pointer {selected
                                        ? 'border-primary ring-2 ring-primary/20'
                                        : 'hover:bg-sidebar-accent'}"
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
                                <button
                                    class="absolute -left-1 -top-1 hidden size-5 items-center justify-center rounded-full bg-background text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity hover:text-foreground group-hover:opacity-100 lg:flex"
                                    title="Open persona settings"
                                    aria-label={`Open ${persona.name} settings`}
                                    onclick={() => openPersonaSettings(persona.id)}
                                >
                                    <Settings class="size-3" />
                                </button>
                                <button
                                    class="absolute left-5 -top-1 hidden size-5 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-border transition-opacity lg:flex {isDefault
                                        ? 'text-primary opacity-100'
                                        : 'text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100'}"
                                    title="Set default persona"
                                    aria-label={`Set ${persona.name} as default persona`}
                                    disabled={panelAction !== null}
                                    aria-busy={panelAction === `default-persona:${persona.id}`}
                                    onclick={() => handleSetDefaultPersona(persona.id)}
                                >
                                    <Pin class="size-3" />
                                </button>
                                <button
                                    type="button"
                                    class="absolute -right-1 -top-1 hidden size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100 lg:flex"
                                    title="Remove from chat"
                                    aria-label={`Remove ${persona.name} from chat`}
                                    disabled={panelAction !== null}
                                    aria-busy={panelAction === `remove-persona:${persona.id}`}
                                    onclick={() => handlePersonaRemove(persona.id)}
                                >
                                    <X class="size-3" />
                                </button>
                            </div>
                        {/snippet}
                    </EntityList>
                </section>
            {/if}

            {#if !$activeChat}
                <div class="p-3 py-8 text-center text-xs text-muted-foreground">
                    Select a chat to view settings.
                </div>
            {:else}
                <!-- Chat Note -->
                <section class="space-y-2 border-b border-sidebar-border p-3">
                    <Label
                        class="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground"
                    >
                        <FileText class="size-3" /> Chat Note
                    </Label>
                    <Textarea
                        rows={4}
                        class="text-xs bg-background"
                        placeholder="Context specific to this conversation..."
                        value={$activeChat.chatNote}
                        oninput={(e) => updateChat({ chatNote: e.currentTarget.value })}
                    />
                    <p class="text-[10px] text-muted-foreground leading-tight">
                        This is added to the AI's memory only for this specific chat.
                    </p>
                </section>

                <!-- Active Lorebooks -->
                <section class="space-y-2 border-b border-sidebar-border p-3">
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

                <!-- Runtime Variables -->
                <section class="space-y-2 border-b border-sidebar-border p-3">
                    <Label
                        class="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground"
                    >
                        <Variable class="size-3" /> Chat Variables
                    </Label>

                    <KeyValueEditor
                        disabled={$messages.length === 0}
                        emptyMessage="No active variables."
                        data={variables}
                        onUpdateValue={handleVariableUpdate}
                        onAdd={handleVariableAdd}
                        onRemove={handleVariableRemove}
                    />
                    {#if $messages.length === 0}
                        <p class="text-[10px] leading-4 text-muted-foreground">
                            Send a message to create an editable variable snapshot.
                        </p>
                    {/if}
                </section>

                <!-- Runtime Assets (Inlays) -->
                <section class="space-y-1.5 border-b border-sidebar-border p-3">
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
                                size="icon"
                                class="size-7"
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
                                    class="touch-visible absolute -left-1 -top-1 z-10 flex size-5 items-center justify-center rounded-full bg-background text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity hover:text-foreground group-hover:opacity-100"
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
                                    class="touch-visible absolute -right-1 -top-1 z-10 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
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
