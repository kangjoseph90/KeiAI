<script lang="ts">
    import {
        Check,
        ChevronDown,
        ChevronRight,
        Edit3,
        Folder,
        FolderOpen,
        Home,
        MessageSquare,
        PanelLeft,
        PanelLeftClose,
        Pin,
        Plus,
        Search,
        Settings,
        Trash2,
        X
    } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import RoomAvatar from '$lib/components/RoomAvatar.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import {
        activeChat,
        activePreset,
        activeRoom,
        addRoomCharacter,
        appSettings,
        characters,
        chatSelections,
        createChat,
        createGlobalFolder,
        createRoomFolder,
        deleteChat,
        deleteGlobalFolder,
        deleteRoomFolder,
        isMultiRoom,
        moveGlobalItem,
        moveRoomItem,
        multiRoomCharacters,
        removeRoomCharacter,
        roomChats,
        roomCharacters,
        rooms,
        setChatDefaultCharacter,
        setChatSelectedCharacter,
        updateChat,
        updateGlobalFolder,
        updateRoomFolder
    } from '$lib/stores';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import { getFolderColorClass } from '$lib/components/entitylist/folders';
    import { setGlobalVariable } from '$lib/managers';
    import type { RouteState } from '$lib/router';
    import { syncChatGreetings } from '$lib/managers';
    import { compareSortOrder } from '$lib/utils/ordering';

    interface Props {
        collapsed?: boolean;
        route: RouteState;
        onToggle: () => void;
        onNavigate: (route: RouteState) => void;
    }

    let { collapsed = false, route, onToggle, onNavigate }: Props = $props();

    let chatSearch = $state('');
    let characterToAdd = $state('');
    let editingChatId = $state<string | null>(null);
    let editingChatTitle = $state('');

    const filteredChats = $derived(() => {
        const query = chatSearch.trim().toLowerCase();
        if (!query) return $roomChats;
        return $roomChats.filter((chat) => chat.title.toLowerCase().includes(query));
    });

    const attachableCharacters = $derived(() => {
        const attached = new Set($roomCharacters.map((character) => character.id));
        const source = $isMultiRoom ? $multiRoomCharacters : $characters;
        return source.filter((character) => !attached.has(character.id));
    });

    async function handleCreateChat() {
        if (!$activeRoom) return;

        const chat = await createChat($activeRoom.id, {
            title: `New Chat ${$roomChats.length + 1}`
        });
        await syncChatGreetings(chat.id);
        onNavigate({ view: 'room', roomId: $activeRoom.id, chatId: chat.id });
    }

    function handleSelectRoom(roomId: string) {
        onNavigate({ view: 'room', roomId });
    }

    function handleOpenCharacter(characterId: string) {
        onNavigate({ view: 'characterStudio', charId: characterId });
    }

    async function handleSelectCharacter(characterId: string) {
        if (!$activeChat) return;
        await setChatSelectedCharacter($activeChat.id, characterId);
    }

    async function handleSetDefaultCharacter(characterId: string) {
        if (!$activeChat) return;
        await setChatDefaultCharacter($activeChat.id, characterId);
    }

    async function handleAddCharacter() {
        if (!$activeRoom || !characterToAdd) return;
        await addRoomCharacter($activeRoom.id, characterToAdd);
        characterToAdd = '';
    }

    async function handleRemoveCharacter(characterId: string) {
        if (!$activeRoom) return;
        await removeRoomCharacter($activeRoom.id, characterId);
    }

    async function handleSelectChat(chatId: string) {
        if (!$activeRoom) return;
        await syncChatGreetings(chatId);
        onNavigate({ view: 'room', roomId: $activeRoom.id, chatId });
    }

    async function handleRenameChat(chatId: string) {
        const title = editingChatTitle.trim();
        if (!title) return;

        await updateChat(chatId, { title });
        editingChatId = null;
        editingChatTitle = '';
    }

    async function handleDeleteChat(chatId: string) {
        if (!$activeRoom) return;

        await deleteChat(chatId, $activeRoom.id);
        if ($activeChat?.id === chatId) {
            onNavigate({ view: 'room', roomId: $activeRoom.id });
        }
    }

    async function handleToggleChange(key: string, value: string) {
        await setGlobalVariable(`toggle_${key}`, value);
    }

    function startRenameChat(chatId: string, title: string) {
        editingChatId = chatId;
        editingChatTitle = title;
    }

    function initial(name: string): string {
        return (name.trim().charAt(0) || '?').toUpperCase();
    }
</script>

<aside class="flex h-full shrink-0 border-r bg-sidebar text-sidebar-foreground">
    <div class="flex w-14 flex-col border-r border-sidebar-border bg-sidebar">
        <div class="flex h-14 items-center justify-center border-b border-sidebar-border">
            <Button
                variant="ghost"
                size="icon"
                class="size-9"
                title="Home"
                onclick={() => onNavigate({ view: 'home' })}
            >
                <Home class="size-4" />
            </Button>
        </div>

        <div class="flex-1 overflow-y-auto px-2 py-2">
            <div class="flex flex-col items-center gap-2 w-full">
                {#if $appSettings}
                    <EntityList
                        entities={$rooms}
                        config={$appSettings.rooms}
                        layout="list"
                        gridClass="flex flex-col gap-2 items-center w-full"
                        listClass="flex flex-col gap-2 items-center w-full"
                        childContainerClass="relative my-1 py-1.5 flex flex-col gap-2 items-center w-full"
                        onCreateFolder={(name, parentId, sortOrder) =>
                            createGlobalFolder('rooms', name, parentId, sortOrder)}
                        onUpdateFolder={(id, changes) => updateGlobalFolder('rooms', id, changes)}
                        onDeleteFolder={(id) => deleteGlobalFolder('rooms', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveGlobalItem('rooms', itemId, newFolderId, newSortOrder)}
                    >
                        {#snippet folder({ folder: f, collapsed, toggle })}
                            <button
                                class="relative flex size-10 items-center justify-center overflow-hidden rounded-md border transition-colors select-none cursor-pointer
                                    {f.color
                                    ? getFolderColorClass(f.color)
                                    : 'border-transparent bg-muted/30 text-foreground hover:bg-muted/50 hover:border-sidebar-border'}"
                                onclick={toggle}
                                title={f.name}
                            >
                                {#if collapsed}
                                    <Folder strokeWidth={2.5} class="size-4 text-inherit" />
                                {:else}
                                    <FolderOpen strokeWidth={2.5} class="size-4 text-inherit" />
                                {/if}
                            </button>
                        {/snippet}

                        {#snippet item({ entity: room })}
                            {@const selected = route.roomId === room.id}
                            <button
                                class="relative flex size-10 items-center justify-center rounded-md border bg-background text-xs font-semibold transition-colors {selected
                                    ? 'border-primary ring-2 ring-primary/20'
                                    : 'border-transparent hover:border-sidebar-border'} group"
                                title={room.name}
                                onclick={() => handleSelectRoom(room.id)}
                            >
                                <RoomAvatar {room} class="size-full" />
                            </button>
                        {/snippet}
                    </EntityList>
                {/if}
            </div>
        </div>

        <div class="flex flex-col items-center gap-2 border-t border-sidebar-border p-2">
            <Button
                variant="ghost"
                size="icon"
                class="size-9"
                title="Settings"
                onclick={() => onNavigate({ view: 'settings' })}
            >
                <Settings class="size-4" />
            </Button>
            {#if $activeRoom}
                <Button
                    variant="ghost"
                    size="icon"
                    class="size-9"
                    title={collapsed ? 'Show room panel' : 'Hide room panel'}
                    onclick={onToggle}
                >
                    {#if collapsed}
                        <PanelLeft class="size-4" />
                    {:else}
                        <PanelLeftClose class="size-4" />
                    {/if}
                </Button>
            {/if}
        </div>
    </div>

    {#if !collapsed && $activeRoom}
        <div class="flex w-80 flex-col bg-sidebar">
            <div class="flex h-14 items-center justify-between border-b border-sidebar-border px-3">
                <div class="min-w-0">
                    <p class="truncate text-sm font-semibold">{$activeRoom.name}</p>
                    <p class="truncate text-[11px] text-muted-foreground">
                        {$activeChat?.title ?? 'No chat selected'}
                    </p>
                </div>
                <Button variant="ghost" size="icon" class="size-8" onclick={handleCreateChat}>
                    <Plus class="size-4" />
                </Button>
            </div>

            <div class="border-b border-sidebar-border p-3">
                <div class="mb-2 flex items-center justify-between">
                    <p class="text-[11px] font-semibold uppercase text-muted-foreground">
                        Characters
                    </p>
                </div>
                <div class="mb-2 flex gap-1.5">
                    <select
                        class="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
                        bind:value={characterToAdd}
                    >
                        <option value="">Add character...</option>
                        {#each attachableCharacters() as character (character.id)}
                            <option value={character.id}>{character.name}</option>
                        {/each}
                    </select>
                    <Button
                        variant="secondary"
                        size="icon"
                        class="size-8 shrink-0"
                        onclick={handleAddCharacter}
                        disabled={!characterToAdd}
                    >
                        <Plus class="size-4" />
                    </Button>
                </div>
                <EntityList
                    entities={$roomCharacters}
                    config={$activeRoom.characters}
                    layout="grid"
                    gridClass="grid grid-cols-3 gap-2"
                    listClass="grid grid-cols-3 gap-2"
                    childContainerClass="relative my-1 py-1.5 pl-2"
                    onCreateFolder={(name, parentId, sortOrder) =>
                        createRoomFolder($activeRoom.id, 'characters', name, parentId, sortOrder)}
                    onUpdateFolder={(id, changes) =>
                        updateRoomFolder($activeRoom.id, 'characters', id, changes)}
                    onDeleteFolder={(id) => deleteRoomFolder($activeRoom.id, 'characters', id)}
                    onMoveItem={(itemId, newFolderId, newSortOrder) =>
                        moveRoomItem(
                            $activeRoom.id,
                            'characters',
                            itemId,
                            newFolderId,
                            newSortOrder
                        )}
                >
                    {#snippet empty()}
                        <div class="col-span-3 rounded-md border border-dashed p-3 text-center">
                            <p class="text-[11px] text-muted-foreground">No characters.</p>
                        </div>
                    {/snippet}
                    {#snippet item({ entity: character })}
                        {@const ref = $activeRoom.characters.refs[character.id]}
                        {@const disabled = ref?.enabled === false}
                        {@const selected = $chatSelections?.characterId === character.id}
                        {@const isDefault = $activeChat?.defaultCharacterId === character.id}
                        <div class="group relative">
                            <button
                                class="flex w-full min-w-0 flex-col items-center gap-1 rounded-md border bg-background p-2 text-center transition-colors {selected
                                    ? 'border-primary ring-2 ring-primary/20'
                                    : 'hover:bg-sidebar-accent'} {disabled ? 'opacity-40' : ''}"
                                title={character.name}
                                disabled={disabled || !$activeChat}
                                onclick={() => handleSelectCharacter(character.id)}
                            >
                                <div
                                    class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-xs font-semibold"
                                >
                                    {#if character.avatar}
                                        <AssetView
                                            asset={{
                                                scopeType: character.scopeType,
                                                scopeId: character.scopeId,
                                                ownerTable: 'characters',
                                                ownerId: character.id,
                                                hash: character.avatar.hash,
                                                encKey: character.avatar.encKey
                                            }}
                                            alt={character.name}
                                            class="size-full object-cover"
                                        />
                                    {:else}
                                        {initial(character.name)}
                                    {/if}
                                </div>
                                <span class="w-full truncate text-[11px]">{character.name}</span>
                            </button>
                            <button
                                class="absolute -left-1 -top-1 flex size-5 items-center justify-center rounded-full bg-background text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity hover:text-foreground group-hover:opacity-100"
                                title="Open character studio"
                                onclick={() => handleOpenCharacter(character.id)}
                            >
                                <Settings class="size-3" />
                            </button>
                            <button
                                class="absolute left-5 -top-1 flex size-5 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-border transition-opacity {isDefault
                                    ? 'text-primary opacity-100'
                                    : 'text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100'}"
                                title="Set default character"
                                disabled={disabled || !$activeChat}
                                onclick={() => handleSetDefaultCharacter(character.id)}
                            >
                                <Pin class="size-3" />
                            </button>
                            <button
                                class="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                                title="Remove from room"
                                onclick={() => handleRemoveCharacter(character.id)}
                            >
                                <X class="size-3" />
                            </button>
                        </div>
                    {/snippet}
                </EntityList>
            </div>

            <div class="border-b border-sidebar-border p-3">
                <div class="relative">
                    <Search
                        class="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                        bind:value={chatSearch}
                        placeholder="Search chats..."
                        class="h-8 pl-8 text-xs"
                    />
                </div>
            </div>

            <div class="flex-1 overflow-y-auto p-2">
                <div class="flex flex-col gap-1">
                    <EntityList
                        entities={filteredChats()}
                        config={$activeRoom.chats}
                        layout="list"
                        onCreateFolder={(name, parentId, sortOrder) =>
                            createRoomFolder($activeRoom.id, 'chats', name, parentId, sortOrder)}
                        onUpdateFolder={(id, changes) =>
                            updateRoomFolder($activeRoom.id, 'chats', id, changes)}
                        onDeleteFolder={(id) => deleteRoomFolder($activeRoom.id, 'chats', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveRoomItem(
                                $activeRoom.id,
                                'chats',
                                itemId,
                                newFolderId,
                                newSortOrder
                            )}
                    >
                        {#snippet empty()}
                            <div class="px-3 py-8 text-center text-xs text-muted-foreground">
                                No chats yet.
                            </div>
                        {/snippet}
                        {#snippet folder({ folder: f, collapsed, toggle, parts })}
                            <div
                                role="button"
                                tabindex="0"
                                class="relative group/folder flex items-center justify-between rounded-md px-2 py-2 text-sm select-none cursor-pointer transition-colors hover:bg-sidebar-accent/50 w-full"
                                onclick={toggle}
                                onkeydown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        toggle();
                                    }
                                }}
                            >
                                <div class="flex items-center gap-2 min-w-0 flex-1">
                                    {#if collapsed}
                                        <Folder
                                            strokeWidth={2.5}
                                            class="size-4 shrink-0 {f.color
                                                ? getFolderColorClass(f.color)
                                                : ''}"
                                        />
                                    {:else}
                                        <FolderOpen
                                            strokeWidth={2.5}
                                            class="size-4 shrink-0 {f.color
                                                ? getFolderColorClass(f.color)
                                                : ''}"
                                        />
                                    {/if}
                                    <div class="flex-1 min-w-0 text-foreground">
                                        {@render parts.name({ folder: f })}
                                    </div>
                                </div>
                                <div class="ml-2">
                                    {@render parts.actions({ folder: f })}
                                </div>
                            </div>
                        {/snippet}
                        {#snippet item({ entity: chat })}
                            {@const selected = route.chatId === chat.id}
                            <div
                                class="group rounded-md px-2 py-2 text-sm transition-colors {selected
                                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                                    : 'hover:bg-sidebar-accent/50'}"
                            >
                                {#if editingChatId === chat.id}
                                    <form
                                        class="flex gap-1"
                                        onsubmit={(event) => {
                                            event.preventDefault();
                                            handleRenameChat(chat.id);
                                        }}
                                    >
                                        <Input
                                            bind:value={editingChatTitle}
                                            class="h-7 flex-1 text-xs text-foreground bg-background"
                                            autofocus
                                            onkeydown={(event) => {
                                                if (event.key === 'Escape') {
                                                    editingChatId = null;
                                                    editingChatTitle = '';
                                                }
                                            }}
                                        />
                                        <Button type="submit" size="icon" class="size-7">
                                            <Check class="size-3" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            class="size-7"
                                            onclick={() => {
                                                editingChatId = null;
                                                editingChatTitle = '';
                                            }}
                                        >
                                            <X class="size-3" />
                                        </Button>
                                    </form>
                                {:else}
                                    <div class="flex items-center gap-2">
                                        <button
                                            class="flex min-w-0 flex-1 items-center gap-2 text-left"
                                            onclick={() => handleSelectChat(chat.id)}
                                        >
                                            <MessageSquare class="size-3.5 shrink-0" />
                                            <span class="min-w-0 flex-1 truncate text-foreground">
                                                {chat.title || 'Untitled Chat'}
                                            </span>
                                        </button>
                                        <button
                                            class="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                                            title="Rename chat"
                                            onclick={() =>
                                                startRenameChat(
                                                    chat.id,
                                                    chat.title || 'Untitled Chat'
                                                )}
                                        >
                                            <Edit3 class="size-3" />
                                        </button>
                                        <button
                                            class="flex size-6 shrink-0 items-center justify-center rounded text-destructive opacity-0 transition-opacity hover:bg-destructive/10 group-hover:opacity-100"
                                            title="Delete chat"
                                            onclick={() => handleDeleteChat(chat.id)}
                                        >
                                            <Trash2 class="size-3" />
                                        </button>
                                    </div>
                                {/if}
                            </div>
                        {/snippet}
                    </EntityList>
                </div>
            </div>

            {#if $activePreset && Object.keys($activePreset.customToggles).length > 0}
                <div class="max-h-56 overflow-y-auto border-t border-sidebar-border p-3">
                    <p class="mb-2 text-[11px] font-semibold uppercase text-muted-foreground">
                        Toggles
                    </p>
                    <div class="flex flex-col gap-2">
                        {#each Object.values($activePreset.customToggles).sort( (a, b) => compareSortOrder(a.sortOrder, b.sortOrder) ) as toggle (toggle.id)}
                            {#if toggle.type === 'caption'}
                                <p class="text-[11px] text-muted-foreground">{toggle.label}</p>
                            {:else if toggle.type === 'divider'}
                                <div class="flex items-center gap-2 py-1">
                                    {#if toggle.label}
                                        <span class="text-[10px] text-muted-foreground"
                                            >{toggle.label}</span
                                        >
                                    {/if}
                                    <div class="h-px flex-1 bg-sidebar-border"></div>
                                </div>
                            {:else if toggle.type === 'group' || toggle.type === 'groupEnd'}
                                {#if toggle.type === 'group' && toggle.label}
                                    <p class="pt-1 text-[11px] font-medium">{toggle.label}</p>
                                {/if}
                            {:else if toggle.type === 'select'}
                                <label class="flex items-center justify-between gap-2 text-xs">
                                    <span class="truncate">{toggle.label}</span>
                                    <select
                                        class="h-7 w-32 rounded-md border bg-background px-2 text-xs"
                                        value={$activePreset.globalVariables[
                                            `toggle_${toggle.key}`
                                        ] ?? '0'}
                                        onchange={(event) =>
                                            handleToggleChange(
                                                toggle.key,
                                                event.currentTarget.value
                                            )}
                                    >
                                        {#each toggle.options as option, optionIndex (optionIndex)}
                                            <option value={String(optionIndex)}>{option}</option>
                                        {/each}
                                    </select>
                                </label>
                            {:else if toggle.type === 'text'}
                                <label class="flex items-center justify-between gap-2 text-xs">
                                    <span class="truncate">{toggle.label}</span>
                                    <Input
                                        class="h-7 w-32 text-xs"
                                        value={$activePreset.globalVariables[
                                            `toggle_${toggle.key}`
                                        ] ?? ''}
                                        oninput={(event) =>
                                            handleToggleChange(
                                                toggle.key,
                                                event.currentTarget.value
                                            )}
                                    />
                                </label>
                            {:else if toggle.type === 'textarea'}
                                <label class="flex flex-col gap-1 text-xs">
                                    <span class="truncate">{toggle.label}</span>
                                    <textarea
                                        class="min-h-16 rounded-md border bg-background px-2 py-1 text-xs"
                                        value={$activePreset.globalVariables[
                                            `toggle_${toggle.key}`
                                        ] ?? ''}
                                        oninput={(event) =>
                                            handleToggleChange(
                                                toggle.key,
                                                event.currentTarget.value
                                            )}
                                    ></textarea>
                                </label>
                            {:else if toggle.key}
                                {@const toggleKey = toggle.key}
                                <label class="flex items-center gap-2 text-xs">
                                    <input
                                        type="checkbox"
                                        class="size-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                                        checked={$activePreset.globalVariables[
                                            `toggle_${toggleKey}`
                                        ] === '1'}
                                        onchange={(event) =>
                                            handleToggleChange(
                                                toggleKey,
                                                event.currentTarget.checked ? '1' : '0'
                                            )}
                                    />
                                    <span class="truncate">{toggle.label}</span>
                                </label>
                            {/if}
                        {/each}
                    </div>
                </div>
            {/if}
        </div>
    {/if}
</aside>
