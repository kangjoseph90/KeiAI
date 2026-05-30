<script lang="ts">
    import {
        Check,
        DoorOpen,
        Import,
        KeyRound,
        Plus,
        Search,
        Sparkles,
        Trash2,
        UserRound,
        X
    } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import {
        appSettings,
        characters,
        createCharacter,
        createGlobalFolder,
        createMultiRoom,
        createPersona,
        createRoom,
        deleteCharacter,
        deleteGlobalFolder,
        deleteMultiRoom,
        deletePersona,
        deleteRoom,
        leaveMultiRoom,
        loadOwnedMultiRoomMembers,
        moveGlobalItem,
        multiRoomMembers,
        multiRoomMetas,
        multiRooms,
        personas,
        rejectJoinMultiRoom,
        requestJoinMultiRoom,
        rooms,
        selectMultiRoom,
        updateGlobalFolder,
        userId
    } from '$lib/stores';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import { importCharacterFile } from '$lib/managers';
    import { importPersonaFile } from '$lib/managers/persona';
    import type { RouteState } from '$lib/router';
    import { MultiRoomService, type PublicMultiRoom } from '$lib/services';
    import { formatPublicKeyFingerprint } from '$lib/crypto';
    import { getErrorMessage } from '$lib/types/errors';
    import { approveMultiRoomJoinRequest } from '$lib/stores';

    interface Props {
        onNavigate: (route: RouteState) => void;
    }

    let { onNavigate }: Props = $props();

    type Tab = 'rooms' | 'multiRooms' | 'characters' | 'personas';
    let tab = $state<Tab>('rooms');
    let query = $state('');
    let creatingRoom = $state(false);
    let creatingMultiRoom = $state(false);
    let creatingCharacter = $state(false);
    let creatingPersona = $state(false);
    let importingCharacter = $state(false);
    let importingPersona = $state(false);
    let roomName = $state('');
    let multiRoomName = $state('');
    let joinRoomId = $state('');
    let publicRoomQuery = $state('');
    let publicRoomResults = $state<PublicMultiRoom[]>([]);
    let multiRoomActionError = $state('');
    let searchingPublicRooms = $state(false);
    let joiningRoom = $state(false);
    let approvingMemberId = $state('');
    let characterName = $state('');
    let personaName = $state('');

    const filteredRooms = $derived(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return $rooms;
        return $rooms.filter((room) => room.name.toLowerCase().includes(normalized));
    });

    const filteredMultiRooms = $derived(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return $multiRooms;
        return $multiRooms.filter((room) => room.name.toLowerCase().includes(normalized));
    });

    function isMultiRoomOwner(roomId: string): boolean {
        return $multiRoomMetas.find((item) => item.id === roomId)?.ownerUserId === $userId;
    }

    const filteredCharacters = $derived(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return $characters;
        return $characters.filter((character) => character.name.toLowerCase().includes(normalized));
    });

    const filteredPersonas = $derived(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return $personas;
        return $personas.filter((persona) => persona.name.toLowerCase().includes(normalized));
    });

    const pendingRequests = $derived(() => {
        const ownedRoomIds = new Set(
            $multiRoomMetas.filter((meta) => meta.ownerUserId === $userId).map((meta) => meta.id)
        );
        return Array.from($multiRoomMembers.entries()).flatMap(([roomId, members]) =>
            ownedRoomIds.has(roomId)
                ? members
                      .filter((member) => member.status === 'pending')
                      .map((member) => ({
                          roomId,
                          roomName: $multiRooms.find((room) => room.id === roomId)?.name ?? roomId,
                          member
                      }))
                : []
        );
    });

    $effect(() => {
        if (tab === 'multiRooms') {
            void loadOwnedMultiRoomMembers();
        }
    });

    async function handleCreateRoom() {
        const trimmed = roomName.trim();
        if (!trimmed) return;

        const room = await createRoom({ name: trimmed });
        roomName = '';
        creatingRoom = false;
        onNavigate({ view: 'room', roomId: room.id });
    }

    async function handleCreateMultiRoom() {
        const trimmed = multiRoomName.trim();
        if (!trimmed) return;

        const room = await createMultiRoom({
            name: trimmed,
            publicName: trimmed,
            visibility: 'public'
        });
        multiRoomName = '';
        creatingMultiRoom = false;
        await openMultiRoom(room.id);
    }

    async function handleSearchPublicRooms() {
        searchingPublicRooms = true;
        multiRoomActionError = '';
        try {
            publicRoomResults = await MultiRoomService.searchPublicRooms(publicRoomQuery);
        } catch (e) {
            multiRoomActionError = getErrorMessage(e);
        } finally {
            searchingPublicRooms = false;
        }
    }

    async function handleRequestJoin(roomId: string) {
        const trimmed = roomId.trim();
        if (!trimmed) return;
        joiningRoom = true;
        multiRoomActionError = '';
        try {
            await requestJoinMultiRoom(trimmed);
            joinRoomId = '';
        } catch (e) {
            multiRoomActionError = getErrorMessage(e);
        } finally {
            joiningRoom = false;
        }
    }

    async function handleApprovePending(roomId: string, memberUserId: string) {
        approvingMemberId = `${roomId}:${memberUserId}`;
        multiRoomActionError = '';
        try {
            const user = await MultiRoomService.getUserPublicKey(memberUserId);
            const fingerprint = await MultiRoomService.fingerprintUserPublicKey(user);
            const trusted = await MultiRoomService.getUserKeyTrust(user.userId);
            const formatted = formatPublicKeyFingerprint(fingerprint);

            if (!trusted) {
                const ok = confirm(
                    `First time seeing ${user.username || user.userId}.\nFingerprint: ${formatted}`
                );
                if (!ok) return;
                await MultiRoomService.trustUserPublicKey(user, fingerprint);
            } else if (trusted.publicKeyFingerprint !== fingerprint) {
                alert(
                    `Public key fingerprint changed for ${user.username || user.userId}.\nPrevious: ${formatPublicKeyFingerprint(trusted.publicKeyFingerprint)}\nCurrent: ${formatted}`
                );
                return;
            } else {
                await MultiRoomService.trustUserPublicKey(user, fingerprint);
            }

            const publicKey = await MultiRoomService.importUserPublicKey(user);
            await approveMultiRoomJoinRequest(roomId, user.userId, publicKey);
            await loadOwnedMultiRoomMembers();
        } catch (e) {
            multiRoomActionError = getErrorMessage(e);
        } finally {
            approvingMemberId = '';
        }
    }

    async function handleRejectPending(roomId: string, memberUserId: string) {
        approvingMemberId = `${roomId}:${memberUserId}`;
        multiRoomActionError = '';
        try {
            await rejectJoinMultiRoom(roomId, memberUserId);
            await loadOwnedMultiRoomMembers();
        } catch (e) {
            multiRoomActionError = getErrorMessage(e);
        } finally {
            approvingMemberId = '';
        }
    }

    async function openMultiRoom(roomId: string) {
        await selectMultiRoom(roomId);
        onNavigate({ view: 'room', roomId });
    }

    async function handleCreateCharacter() {
        const trimmed = characterName.trim();
        if (!trimmed) return;

        const character = await createCharacter({
            name: trimmed,
            description: ''
        });
        characterName = '';
        creatingCharacter = false;
        onNavigate({ view: 'characterStudio', charId: character.id });
    }

    async function handleImportCharacter(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file || importingCharacter) return;

        importingCharacter = true;
        try {
            const character = await importCharacterFile(file, {
                allowLightAssets: false,
                select: true
            });
            onNavigate({ view: 'characterStudio', charId: character.id });
        } finally {
            importingCharacter = false;
        }
    }

    async function handleDeleteCharacter(characterId: string, name: string) {
        if (!confirm(`Delete character "${name}"?`)) return;
        await deleteCharacter(characterId);
    }

    async function handleDeleteRoom(roomId: string, name: string) {
        if (!confirm(`Delete room "${name}"?`)) return;
        await deleteRoom(roomId);
    }

    async function handleDeleteMultiRoom(roomId: string, name: string) {
        if (!confirm(`Delete multi room "${name}"?`)) return;
        await deleteMultiRoom(roomId);
    }

    async function handleLeaveMultiRoom(roomId: string, name: string) {
        if (!confirm(`Leave multi room "${name}"?`)) return;
        await leaveMultiRoom(roomId);
    }

    async function handleImportPersona(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file || importingPersona) return;

        importingPersona = true;
        try {
            const persona = await importPersonaFile(file, { select: true });
            onNavigate({ view: 'personaStudio', personaId: persona.id });
        } finally {
            importingPersona = false;
        }
    }

    async function handleDeletePersona(personaId: string, name: string) {
        if (!confirm(`Delete persona "${name}"?`)) return;
        await deletePersona(personaId);
    }

    async function handleCreatePersona() {
        const trimmed = personaName.trim();
        if (!trimmed) return;

        const persona = await createPersona({
            name: trimmed,
            description: ''
        });
        personaName = '';
        creatingPersona = false;
        onNavigate({ view: 'personaStudio', personaId: persona.id });
    }

    function searchPlaceholder(): string {
        if (tab === 'rooms') return 'Search rooms...';
        if (tab === 'multiRooms') return 'Search multi rooms...';
        if (tab === 'characters') return 'Search characters...';
        return 'Search personas...';
    }

    function initial(nameValue: string): string {
        return (nameValue.trim().charAt(0) || '?').toUpperCase();
    }
</script>

<div class="flex h-full flex-col overflow-hidden bg-background">
    <header class="shrink-0 border-b px-8 py-6">
        <div class="flex items-center justify-between gap-4">
            <div>
                <h1 class="text-xl font-semibold">Library</h1>
                <p class="mt-1 text-sm text-muted-foreground">
                    Open a room, edit characters, or manage personas.
                </p>
            </div>
            {#if tab === 'rooms'}
                {#if creatingRoom}
                    <form
                        class="flex w-full max-w-sm gap-2"
                        onsubmit={(event) => {
                            event.preventDefault();
                            handleCreateRoom();
                        }}
                    >
                        <Input bind:value={roomName} placeholder="Room name..." autofocus />
                        <Button type="submit">Create</Button>
                    </form>
                {:else}
                    <Button class="gap-2" onclick={() => (creatingRoom = true)}>
                        <Plus class="size-4" />
                        New Room
                    </Button>
                {/if}
            {:else if tab === 'multiRooms'}
                {#if creatingMultiRoom}
                    <form
                        class="flex w-full max-w-sm gap-2"
                        onsubmit={(event) => {
                            event.preventDefault();
                            handleCreateMultiRoom();
                        }}
                    >
                        <Input
                            bind:value={multiRoomName}
                            placeholder="Multi room name..."
                            autofocus
                        />
                        <Button type="submit">Create</Button>
                    </form>
                {:else}
                    <Button class="gap-2" onclick={() => (creatingMultiRoom = true)}>
                        <Plus class="size-4" />
                        New Multi Room
                    </Button>
                {/if}
            {:else if tab === 'characters'}
                {#if creatingCharacter}
                    <form
                        class="flex w-full max-w-sm gap-2"
                        onsubmit={(event) => {
                            event.preventDefault();
                            handleCreateCharacter();
                        }}
                    >
                        <Input
                            bind:value={characterName}
                            placeholder="Character name..."
                            autofocus
                        />
                        <Button type="submit">Create</Button>
                    </form>
                {:else}
                    <div class="flex gap-2">
                        <Button
                            variant="outline"
                            class="gap-2"
                            disabled={importingCharacter}
                            onclick={() =>
                                document.getElementById('character-import-input')?.click()}
                        >
                            <Import class="size-4" />
                            Import
                        </Button>
                        <Button class="gap-2" onclick={() => (creatingCharacter = true)}>
                            <Plus class="size-4" />
                            New Character
                        </Button>
                        <input
                            id="character-import-input"
                            type="file"
                            class="hidden"
                            accept=".json,.png,.charx,.jpg,.jpeg,.keichar"
                            onchange={handleImportCharacter}
                        />
                    </div>
                {/if}
            {:else if creatingPersona}
                <form
                    class="flex w-full max-w-sm gap-2"
                    onsubmit={(event) => {
                        event.preventDefault();
                        handleCreatePersona();
                    }}
                >
                    <Input bind:value={personaName} placeholder="Persona name..." autofocus />
                    <Button type="submit">Create</Button>
                </form>
            {:else}
                <div class="flex gap-2">
                    <Button
                        variant="outline"
                        class="gap-2"
                        disabled={importingPersona}
                        onclick={() => document.getElementById('persona-import-input')?.click()}
                    >
                        <Import class="size-4" />
                        Import
                    </Button>
                    <Button class="gap-2" onclick={() => (creatingPersona = true)}>
                        <Plus class="size-4" />
                        New Persona
                    </Button>
                    <input
                        id="persona-import-input"
                        type="file"
                        class="hidden"
                        accept=".png,.keipersona"
                        onchange={handleImportPersona}
                    />
                </div>
            {/if}
        </div>
    </header>

    <main class="flex-1 overflow-y-auto px-8 py-8">
        <div class="mx-auto max-w-6xl space-y-6">
            <div class="flex flex-wrap items-center justify-between gap-4">
                <div class="flex rounded-md border bg-muted/30 p-1">
                    <button
                        class="rounded px-3 py-1.5 text-sm font-medium transition-colors {tab ===
                        'rooms'
                            ? 'bg-background shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'}"
                        onclick={() => (tab = 'rooms')}
                    >
                        Rooms
                    </button>
                    <button
                        class="rounded px-3 py-1.5 text-sm font-medium transition-colors {tab ===
                        'multiRooms'
                            ? 'bg-background shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'}"
                        onclick={() => (tab = 'multiRooms')}
                    >
                        Multi Rooms
                    </button>
                    <button
                        class="rounded px-3 py-1.5 text-sm font-medium transition-colors {tab ===
                        'characters'
                            ? 'bg-background shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'}"
                        onclick={() => (tab = 'characters')}
                    >
                        Characters
                    </button>
                    <button
                        class="rounded px-3 py-1.5 text-sm font-medium transition-colors {tab ===
                        'personas'
                            ? 'bg-background shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'}"
                        onclick={() => (tab = 'personas')}
                    >
                        Personas
                    </button>
                </div>

                <div class="relative w-full max-w-md">
                    <Search
                        class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input bind:value={query} placeholder={searchPlaceholder()} class="pl-9" />
                </div>
            </div>

            {#if $appSettings}
                {#if tab === 'rooms'}
                    <EntityList
                        entities={filteredRooms()}
                        config={$appSettings.rooms}
                        layout="grid"
                        childContainerClass="relative ml-6 p-3 my-1"
                        onCreateFolder={(name, parentId) =>
                            createGlobalFolder('rooms', name, parentId)}
                        onUpdateFolder={(id, changes) => updateGlobalFolder('rooms', id, changes)}
                        onDeleteFolder={(id) => deleteGlobalFolder('rooms', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveGlobalItem('rooms', itemId, newFolderId, newSortOrder)}
                    >
                        {#snippet empty()}
                            <div class="flex h-[50vh] items-center justify-center">
                                <div class="max-w-sm text-center">
                                    <div
                                        class="mx-auto flex size-14 items-center justify-center rounded-full bg-muted"
                                    >
                                        <DoorOpen class="size-6 text-muted-foreground" />
                                    </div>
                                    <h2 class="mt-4 text-lg font-semibold">
                                        Create your first room
                                    </h2>
                                    <p class="mt-2 text-sm text-muted-foreground">
                                        Rooms hold character refs, chats, and conversation context.
                                    </p>
                                    <Button
                                        class="mt-5 gap-2"
                                        onclick={() => (creatingRoom = true)}
                                    >
                                        <Plus class="size-4" />
                                        New Room
                                    </Button>
                                </div>
                            </div>
                        {/snippet}
                        {#snippet item({ entity: room })}
                            {@const characterCount = Object.keys(room.characters.refs).length}
                            {@const chatCount = Object.keys(room.chats.refs).length}
                            <div
                                class="flex w-full min-h-28 flex-col items-start rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50"
                            >
                                <div class="flex w-full items-center gap-3">
                                    <button
                                        class="flex min-w-0 flex-1 items-center gap-3 text-left"
                                        onclick={() =>
                                            onNavigate({ view: 'room', roomId: room.id })}
                                    >
                                        <div
                                            class="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-foreground"
                                        >
                                            {initial(room.name)}
                                        </div>
                                        <div class="min-w-0">
                                            <h2
                                                class="truncate text-sm font-semibold text-foreground"
                                            >
                                                {room.name}
                                            </h2>
                                            <p
                                                class="mt-0.5 truncate text-xs text-muted-foreground"
                                            >
                                                {characterCount} characters / {chatCount} chats
                                            </p>
                                        </div>
                                    </button>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        class="shrink-0 text-muted-foreground hover:text-destructive"
                                        title="Delete room"
                                        onclick={() => handleDeleteRoom(room.id, room.name)}
                                    >
                                        <Trash2 class="size-4" />
                                    </Button>
                                </div>
                                <button
                                    class="mt-auto flex items-center gap-1 pt-5 text-xs text-muted-foreground"
                                    onclick={() => onNavigate({ view: 'room', roomId: room.id })}
                                >
                                    <DoorOpen class="size-3.5" />
                                    Open room
                                </button>
                            </div>
                        {/snippet}
                    </EntityList>
                {:else if tab === 'multiRooms'}
                    <div class="grid gap-3 lg:grid-cols-3">
                        <form
                            class="rounded-lg border bg-card p-3"
                            onsubmit={(event) => {
                                event.preventDefault();
                                handleRequestJoin(joinRoomId);
                            }}
                        >
                            <div class="flex gap-2">
                                <Input bind:value={joinRoomId} placeholder="Room id" />
                                <Button type="submit" disabled={joiningRoom || !joinRoomId.trim()}>
                                    <KeyRound class="size-4" />
                                </Button>
                            </div>
                        </form>

                        <form
                            class="rounded-lg border bg-card p-3 lg:col-span-2"
                            onsubmit={(event) => {
                                event.preventDefault();
                                handleSearchPublicRooms();
                            }}
                        >
                            <div class="flex gap-2">
                                <Input bind:value={publicRoomQuery} placeholder="Public room" />
                                <Button type="submit" disabled={searchingPublicRooms}>
                                    <Search class="size-4" />
                                </Button>
                            </div>
                            {#if publicRoomResults.length > 0}
                                <div class="mt-3 grid gap-2 sm:grid-cols-2">
                                    {#each publicRoomResults as result (result.id)}
                                        <div
                                            class="flex min-w-0 items-center justify-between gap-2 rounded-md border bg-background px-3 py-2"
                                        >
                                            <div class="min-w-0">
                                                <div class="truncate text-sm font-medium">
                                                    {result.publicName || result.id}
                                                </div>
                                                <div class="truncate text-xs text-muted-foreground">
                                                    {result.id}
                                                </div>
                                            </div>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={joiningRoom}
                                                onclick={() => handleRequestJoin(result.id)}
                                            >
                                                <KeyRound class="size-4" />
                                            </Button>
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        </form>
                    </div>

                    {#if pendingRequests().length > 0}
                        <div class="rounded-lg border bg-card p-3">
                            <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                {#each pendingRequests() as request (request.member.id)}
                                    <div
                                        class="flex min-w-0 items-center justify-between gap-2 rounded-md border bg-background px-3 py-2"
                                    >
                                        <div class="min-w-0">
                                            <div class="truncate text-sm font-medium">
                                                {request.roomName}
                                            </div>
                                            <div class="truncate text-xs text-muted-foreground">
                                                {request.member.userId}
                                            </div>
                                        </div>
                                        <div class="flex shrink-0 gap-1">
                                            <Button
                                                size="icon-sm"
                                                variant="outline"
                                                title="Approve"
                                                disabled={approvingMemberId ===
                                                    `${request.roomId}:${request.member.userId}`}
                                                onclick={() =>
                                                    handleApprovePending(
                                                        request.roomId,
                                                        request.member.userId
                                                    )}
                                            >
                                                <Check class="size-4" />
                                            </Button>
                                            <Button
                                                size="icon-sm"
                                                variant="ghost"
                                                title="Reject"
                                                disabled={approvingMemberId ===
                                                    `${request.roomId}:${request.member.userId}`}
                                                onclick={() =>
                                                    handleRejectPending(
                                                        request.roomId,
                                                        request.member.userId
                                                    )}
                                            >
                                                <X class="size-4" />
                                            </Button>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {/if}

                    {#if multiRoomActionError}
                        <div
                            class="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
                        >
                            {multiRoomActionError}
                        </div>
                    {/if}

                    <EntityList
                        entities={filteredMultiRooms()}
                        config={$appSettings.multiRooms}
                        layout="grid"
                        childContainerClass="relative ml-6 p-3 my-1"
                        onCreateFolder={(name, parentId) =>
                            createGlobalFolder('multiRooms', name, parentId)}
                        onUpdateFolder={(id, changes) =>
                            updateGlobalFolder('multiRooms', id, changes)}
                        onDeleteFolder={(id) => deleteGlobalFolder('multiRooms', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveGlobalItem('multiRooms', itemId, newFolderId, newSortOrder)}
                    >
                        {#snippet empty()}
                            <div class="flex h-[50vh] items-center justify-center">
                                <div class="max-w-sm text-center">
                                    <div
                                        class="mx-auto flex size-14 items-center justify-center rounded-full bg-muted"
                                    >
                                        <DoorOpen class="size-6 text-muted-foreground" />
                                    </div>
                                    <h2 class="mt-4 text-lg font-semibold">
                                        Create your first multi room
                                    </h2>
                                    <p class="mt-2 text-sm text-muted-foreground">
                                        Multi rooms are shared spaces with room-scoped content.
                                    </p>
                                    <Button
                                        class="mt-5 gap-2"
                                        onclick={() => (creatingMultiRoom = true)}
                                    >
                                        <Plus class="size-4" />
                                        New Multi Room
                                    </Button>
                                </div>
                            </div>
                        {/snippet}
                        {#snippet item({ entity: room })}
                            {@const characterCount = Object.keys(room.characters.refs).length}
                            {@const chatCount = Object.keys(room.chats.refs).length}
                            <div
                                class="flex w-full min-h-28 flex-col items-start rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50"
                            >
                                <div class="flex w-full items-center gap-3">
                                    <button
                                        class="flex min-w-0 flex-1 items-center gap-3 text-left"
                                        onclick={() => openMultiRoom(room.id)}
                                    >
                                        <div
                                            class="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold"
                                        >
                                            {initial(room.name)}
                                        </div>
                                        <div class="min-w-0">
                                            <h2 class="truncate text-sm font-semibold">
                                                {room.name}
                                            </h2>
                                            <p
                                                class="mt-0.5 truncate text-xs text-muted-foreground"
                                            >
                                                {characterCount} characters / {chatCount} chats
                                            </p>
                                        </div>
                                    </button>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        class="shrink-0 text-muted-foreground hover:text-destructive"
                                        title={isMultiRoomOwner(room.id)
                                            ? 'Delete multi room'
                                            : 'Leave multi room'}
                                        onclick={() =>
                                            isMultiRoomOwner(room.id)
                                                ? handleDeleteMultiRoom(room.id, room.name)
                                                : handleLeaveMultiRoom(room.id, room.name)}
                                    >
                                        {#if isMultiRoomOwner(room.id)}
                                            <Trash2 class="size-4" />
                                        {:else}
                                            <DoorOpen class="size-4" />
                                        {/if}
                                    </Button>
                                </div>
                                <button
                                    class="mt-auto flex items-center gap-1 pt-5 text-xs text-muted-foreground"
                                    onclick={() => openMultiRoom(room.id)}
                                >
                                    <DoorOpen class="size-3.5" />
                                    Open multi room
                                </button>
                            </div>
                        {/snippet}
                    </EntityList>
                {:else if tab === 'characters'}
                    <EntityList
                        entities={filteredCharacters()}
                        config={$appSettings.characters}
                        layout="grid"
                        childContainerClass="relative ml-6 p-3 my-1"
                        onCreateFolder={(name, parentId) =>
                            createGlobalFolder('characters', name, parentId)}
                        onUpdateFolder={(id, changes) =>
                            updateGlobalFolder('characters', id, changes)}
                        onDeleteFolder={(id) => deleteGlobalFolder('characters', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveGlobalItem('characters', itemId, newFolderId, newSortOrder)}
                    >
                        {#snippet empty()}
                            <div class="flex h-[50vh] items-center justify-center">
                                <div class="max-w-sm text-center">
                                    <div
                                        class="mx-auto flex size-14 items-center justify-center rounded-full bg-muted"
                                    >
                                        <Sparkles class="size-6 text-muted-foreground" />
                                    </div>
                                    <h2 class="mt-4 text-lg font-semibold">
                                        Create your first character
                                    </h2>
                                    <p class="mt-2 text-sm text-muted-foreground">
                                        Characters are global resources you can add to rooms.
                                    </p>
                                    <Button
                                        class="mt-5 gap-2"
                                        onclick={() => (creatingCharacter = true)}
                                    >
                                        <Plus class="size-4" />
                                        New Character
                                    </Button>
                                </div>
                            </div>
                        {/snippet}
                        {#snippet item({ entity: character })}
                            <div
                                class="flex w-full min-h-32 flex-col items-start rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50"
                            >
                                <div class="flex w-full items-center gap-3">
                                    <button
                                        class="flex min-w-0 flex-1 items-center gap-3 text-left"
                                        onclick={() =>
                                            onNavigate({
                                                view: 'characterStudio',
                                                charId: character.id
                                            })}
                                    >
                                        <div
                                            class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-sm font-semibold"
                                        >
                                            {#if character.avatarAssetId}
                                                <AssetView
                                                    id={character.avatarAssetId}
                                                    alt={character.name}
                                                    class="size-full object-cover"
                                                />
                                            {:else}
                                                {initial(character.name)}
                                            {/if}
                                        </div>
                                        <div class="min-w-0">
                                            <h2 class="truncate text-sm font-semibold">
                                                {character.name}
                                            </h2>
                                            <p
                                                class="mt-0.5 truncate text-xs text-muted-foreground"
                                            >
                                                {character.description || 'No description'}
                                            </p>
                                        </div>
                                    </button>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        class="shrink-0 text-muted-foreground hover:text-destructive"
                                        title="Delete character"
                                        onclick={() =>
                                            handleDeleteCharacter(character.id, character.name)}
                                    >
                                        <Trash2 class="size-4" />
                                    </Button>
                                </div>
                                <button
                                    class="mt-auto flex items-center gap-1 pt-5 text-xs text-muted-foreground"
                                    onclick={() =>
                                        onNavigate({
                                            view: 'characterStudio',
                                            charId: character.id
                                        })}
                                >
                                    <UserRound class="size-3.5" />
                                    Open studio
                                </button>
                            </div>
                        {/snippet}
                    </EntityList>
                {:else if tab === 'personas'}
                    <EntityList
                        entities={filteredPersonas()}
                        config={$appSettings.personas}
                        layout="grid"
                        childContainerClass="relative ml-6 p-3 my-1"
                        onCreateFolder={(name, parentId) =>
                            createGlobalFolder('personas', name, parentId)}
                        onUpdateFolder={(id, changes) =>
                            updateGlobalFolder('personas', id, changes)}
                        onDeleteFolder={(id) => deleteGlobalFolder('personas', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveGlobalItem('personas', itemId, newFolderId, newSortOrder)}
                    >
                        {#snippet empty()}
                            <div class="flex h-[50vh] items-center justify-center">
                                <div class="max-w-sm text-center">
                                    <div
                                        class="mx-auto flex size-14 items-center justify-center rounded-full bg-muted"
                                    >
                                        <UserRound class="size-6 text-muted-foreground" />
                                    </div>
                                    <h2 class="mt-4 text-lg font-semibold">
                                        Create your first persona
                                    </h2>
                                    <p class="mt-2 text-sm text-muted-foreground">
                                        Personas are user speakers you can attach to chats.
                                    </p>
                                    <Button
                                        class="mt-5 gap-2"
                                        onclick={() => (creatingPersona = true)}
                                    >
                                        <Plus class="size-4" />
                                        New Persona
                                    </Button>
                                </div>
                            </div>
                        {/snippet}
                        {#snippet item({ entity: persona })}
                            <div
                                class="flex w-full min-h-32 flex-col items-start rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50"
                            >
                                <div class="flex w-full items-center gap-3">
                                    <button
                                        class="flex min-w-0 flex-1 items-center gap-3 text-left"
                                        onclick={() =>
                                            onNavigate({
                                                view: 'personaStudio',
                                                personaId: persona.id
                                            })}
                                    >
                                        <div
                                            class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-sm font-semibold"
                                        >
                                            {#if persona.avatarAssetId}
                                                <AssetView
                                                    id={persona.avatarAssetId}
                                                    alt={persona.name}
                                                    class="size-full object-cover"
                                                />
                                            {:else}
                                                {initial(persona.name)}
                                            {/if}
                                        </div>
                                        <div class="min-w-0">
                                            <h2 class="truncate text-sm font-semibold">
                                                {persona.name}
                                            </h2>
                                            <p
                                                class="mt-0.5 truncate text-xs text-muted-foreground"
                                            >
                                                {persona.description || 'No description'}
                                            </p>
                                        </div>
                                    </button>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        class="shrink-0 text-muted-foreground hover:text-destructive"
                                        title="Delete persona"
                                        onclick={() =>
                                            handleDeletePersona(persona.id, persona.name)}
                                    >
                                        <Trash2 class="size-4" />
                                    </Button>
                                </div>
                                <button
                                    class="mt-auto flex items-center gap-1 pt-5 text-xs text-muted-foreground"
                                    onclick={() =>
                                        onNavigate({
                                            view: 'personaStudio',
                                            personaId: persona.id
                                        })}
                                >
                                    <UserRound class="size-3.5" />
                                    Open studio
                                </button>
                            </div>
                        {/snippet}
                    </EntityList>
                {/if}
            {/if}
        </div>
    </main>
</div>
