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
        ChevronRight,
        Paperclip,
        X
    } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import ResourcePickerDialog from '$lib/components/ResourcePickerDialog.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Badge } from '$lib/components/ui/badge';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import { Textarea } from '$lib/components/ui/textarea';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import {
        activeChat,
        addChatPersona,
        appSettings,
        chatPersonas,
        chatLorebooks,
        chatSelections,
        createChatFolder,
        createChatLorebook,
        createChatInlay,
        deleteChatLorebook,
        deleteChatFolder,
        deleteChatInlay,
        isMultiRoom,
        multiRoomPersonas,
        personas,
        removeChatPersona,
        setChatDefaultPersona,
        setChatSelectedPersona,
        moveChatItem,
        updateChatContent,
        updateChatFolder,
        updateChatLorebook
    } from '$lib/stores';
    import { personaPickerOpen } from '$lib/ui';
    import { navigate } from '$lib/router';
    import { addChatPersonaFromLibrary, getChatVariables } from '$lib/managers';
    import type { ChatContent } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import LorebookItem from '$lib/views/modules/LorebookItem.svelte';
    import { appDialog } from '$lib/adapters/dialog';

    interface Props {
        chatId: string;
        onSelectInlay?: (assetId: string) => void;
    }

    let { chatId, onSelectInlay }: Props = $props();

    let newChatLorebookName = $state('');
    let variables = $state<[string, string][]>([]);

    const pickerPersonas = $derived($isMultiRoom ? $multiRoomPersonas : $personas);
    const personaPickerConfig = $derived(
        $isMultiRoom
            ? { refs: {}, folders: {} }
            : ($appSettings?.personas ?? { refs: {}, folders: {} })
    );

    async function updateChat(changes: DeepPartial<ChatContent>) {
        if (!$activeChat) return;
        await updateChatContent(chatId, changes);
    }

    $effect(() => {
        if (chatId) {
            getChatVariables(chatId).then((v) => {
                variables = Object.entries(v);
            });
        } else {
            variables = [];
        }
    });

    async function handleChatLorebookAdd() {
        if (!newChatLorebookName.trim()) return;
        await createChatLorebook(chatId, {
            name: newChatLorebookName,
            key: '',
            secondKey: '',
            content: '',
            depth: 0,
            disabled: false
        });
        newChatLorebookName = '';
    }

    function openPersonaSettings(personaId: string) {
        navigate({ view: 'personaStudio', personaId });
    }

    async function handleInlayUpload() {
        const file = await appDialog.openFile({
            title: 'Upload Gallery Image',
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
        });
        if (!$activeChat || !file) return;
        await createChatInlay(chatId, file);
    }

    async function handlePersonaSelect(personaId: string) {
        if (!$activeChat) return;
        await setChatSelectedPersona(chatId, personaId);
    }

    async function handleSetDefaultPersona(personaId: string) {
        if (!$activeChat) return;
        await setChatDefaultPersona(chatId, personaId);
    }

    async function handlePersonasAdd(personaIds: string[]) {
        if (!$activeChat) return;
        for (const personaId of personaIds) {
            await addChatPersona(chatId, personaId);
        }
    }

    async function handlePersonasCopy(personaIds: string[]) {
        if (!$activeChat) return;
        for (const personaId of personaIds) {
            await addChatPersonaFromLibrary(chatId, personaId);
        }
    }

    async function handlePersonaRemove(personaId: string) {
        if (!$activeChat) return;
        await removeChatPersona(chatId, personaId);
    }

    function initial(name: string): string {
        return (name.trim().charAt(0) || '?').toUpperCase();
    }
</script>

<div class="flex h-full flex-col border-l border-sidebar-border bg-sidebar">
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
                        childContainerClass="relative my-1 py-1.5 pl-2"
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
                            <div class="col-span-3 rounded-md border border-dashed p-3 text-center">
                                <p class="text-[10px] text-muted-foreground">
                                    No personas attached to this chat.
                                </p>
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
                                                    encKey: persona.avatar.encKey
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
                                <button
                                    class="absolute -left-1 -top-1 flex size-5 items-center justify-center rounded-full bg-background text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity hover:text-foreground group-hover:opacity-100"
                                    title="Open persona settings"
                                    onclick={() => openPersonaSettings(persona.id)}
                                >
                                    <Settings class="size-3" />
                                </button>
                                <button
                                    class="absolute left-5 -top-1 flex size-5 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-border transition-opacity {isDefault
                                        ? 'text-primary opacity-100'
                                        : 'text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100'}"
                                    title="Set default persona"
                                    onclick={() => handleSetDefaultPersona(persona.id)}
                                >
                                    <Pin class="size-3" />
                                </button>
                                <button
                                    class="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                                    title="Remove from chat"
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
                        <Badge variant="outline" class="text-[10px] font-mono"
                            >{$chatLorebooks.length}</Badge
                        >
                    </div>

                    <div class="flex gap-1.5">
                        <Input
                            placeholder="New lorebook..."
                            class="h-8 text-xs bg-background"
                            bind:value={newChatLorebookName}
                            onkeydown={(e) => e.key === 'Enter' && handleChatLorebookAdd()}
                        />
                        <Button
                            variant="secondary"
                            size="icon"
                            class="size-8 shrink-0"
                            onclick={handleChatLorebookAdd}
                        >
                            <Plus class="size-4" />
                        </Button>
                    </div>

                    <EntityList
                        entities={$chatLorebooks}
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
                            <p class="py-2 text-center text-[10px] italic text-muted-foreground">
                                No chat lorebooks.
                            </p>
                        {/snippet}
                        {#snippet item({ entity: lb })}
                            <LorebookItem
                                item={lb}
                                onUpdate={(id, changes) => updateChatLorebook(chatId, id, changes)}
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

                    <div class="bg-background border rounded-md divide-y overflow-hidden">
                        {#each variables as [key, val] (key)}
                            <div
                                class="px-3 py-2 flex items-center justify-between gap-2 text-[11px]"
                            >
                                <code class="bg-muted px-1 rounded text-primary font-mono"
                                    >{key}</code
                                >
                                <span class="text-muted-foreground truncate max-w-[120px]"
                                    >{val || '(empty)'}</span
                                >
                            </div>
                        {:else}
                            <p class="p-3 text-[10px] text-muted-foreground italic text-center">
                                No active variables.
                            </p>
                        {/each}
                    </div>
                </section>

                <!-- Runtime Assets (Inlays) -->
                <section class="space-y-2 border-b border-sidebar-border p-3">
                    <div class="flex items-center justify-between">
                        <Label
                            class="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground"
                        >
                            <ImageIcon class="size-3" /> Gallery
                        </Label>
                        <div class="flex items-center gap-2">
                            <Badge variant="outline" class="text-[10px] font-mono"
                                >{Object.keys($activeChat?.inlays?.refs ?? {}).length}</Badge
                            >
                            <Button
                                variant="secondary"
                                size="icon"
                                class="size-7"
                                onclick={handleInlayUpload}
                            >
                                <Plus class="size-3" />
                            </Button>
                        </div>
                    </div>
                    <EntityList
                        entities={Object.values($activeChat?.inlays?.refs ?? {})}
                        config={$activeChat?.inlays ?? { refs: {}, folders: {} }}
                        layout="grid"
                        gridClass="grid grid-cols-3 gap-2 w-full"
                        onCreateFolder={(name, parentId, sortOrder) =>
                            createChatFolder(chatId, 'inlays', name, parentId, sortOrder)}
                        onUpdateFolder={(id, changes) =>
                            updateChatFolder(chatId, 'inlays', id, changes)}
                        onDeleteFolder={(id) => deleteChatFolder(chatId, 'inlays', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveChatItem(chatId, 'inlays', itemId, newFolderId, newSortOrder)}
                    >
                        {#snippet empty()}
                            <div
                                class="col-span-full aspect-square rounded border border-dashed border-muted-foreground/30 flex items-center justify-center"
                            >
                                <p class="text-[10px] text-muted-foreground">No images.</p>
                            </div>
                        {/snippet}
                        {#snippet item({ entity: ref })}
                            {@const chat = $activeChat!}
                            <div class="group relative aspect-square overflow-visible rounded-lg">
                                <div class="absolute inset-0 overflow-hidden rounded-lg border">
                                    <AssetView
                                        asset={{
                                            scopeType: chat.scopeType,
                                            scopeId: chat.scopeId,
                                            ownerTable: 'chats',
                                            ownerId: chat.id,
                                            hash: ref.hash,
                                            encKey: ref.encKey
                                        }}
                                        alt={ref.name}
                                        class="size-full object-cover"
                                        fallback="none"
                                    />
                                </div>
                                <button
                                    type="button"
                                    class="absolute -left-1 -top-1 z-10 flex size-5 items-center justify-center rounded-full bg-background text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity hover:text-foreground group-hover:opacity-100"
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
                                    class="absolute -right-1 -top-1 z-10 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                                    title="Delete"
                                    onclick={(event) => {
                                        event.stopPropagation();
                                        deleteChatInlay(chatId, ref.id);
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

<ResourcePickerDialog
    bind:open={$personaPickerOpen}
    title="Add personas"
    description="Choose the personas available in this chat. You can add several at once."
    singularLabel="persona"
    resourceLabel="personas"
    resources={pickerPersonas}
    config={personaPickerConfig}
    attachedIds={$chatPersonas.map((persona) => persona.id)}
    ownerTable="personas"
    onAdd={handlePersonasAdd}
    roomTabLabel="Room personas"
    libraryResources={$isMultiRoom ? $personas : undefined}
    libraryConfig={$isMultiRoom ? $appSettings?.personas : undefined}
    onCopy={$isMultiRoom ? handlePersonasCopy : undefined}
/>
