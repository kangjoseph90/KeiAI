<script lang="ts">
    import { DoorOpen, Import, Plus, Search, Sparkles, UserRound } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import {
        characters,
        createCharacter,
        createMultiRoom,
        createPersona,
        createRoom,
        multiRooms,
        personas,
        rooms,
        selectMultiRoom
    } from '$lib/stores';
    import { importCharacterFile } from '$lib/managers';
    import { importPersonaFile } from '$lib/managers/persona';
    import type { RouteState } from '$lib/router';

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

            {#if tab === 'rooms'}
                {#if $rooms.length === 0}
                    <div class="flex h-[50vh] items-center justify-center">
                        <div class="max-w-sm text-center">
                            <div
                                class="mx-auto flex size-14 items-center justify-center rounded-full bg-muted"
                            >
                                <DoorOpen class="size-6 text-muted-foreground" />
                            </div>
                            <h2 class="mt-4 text-lg font-semibold">Create your first room</h2>
                            <p class="mt-2 text-sm text-muted-foreground">
                                Rooms hold character refs, chats, and conversation context.
                            </p>
                            <Button class="mt-5 gap-2" onclick={() => (creatingRoom = true)}>
                                <Plus class="size-4" />
                                New Room
                            </Button>
                        </div>
                    </div>
                {:else}
                    <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {#each filteredRooms() as room (room.id)}
                            {@const characterCount = Object.keys(room.characters.refs).length}
                            {@const chatCount = Object.keys(room.chats.refs).length}
                            <button
                                class="flex min-h-28 flex-col items-start rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50"
                                onclick={() => onNavigate({ view: 'room', roomId: room.id })}
                            >
                                <div class="flex w-full items-center gap-3">
                                    <div
                                        class="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold"
                                    >
                                        {initial(room.name)}
                                    </div>
                                    <div class="min-w-0">
                                        <h2 class="truncate text-sm font-semibold">{room.name}</h2>
                                        <p class="mt-0.5 truncate text-xs text-muted-foreground">
                                            {characterCount} characters / {chatCount} chats
                                        </p>
                                    </div>
                                </div>
                                <div
                                    class="mt-auto flex items-center gap-1 pt-5 text-xs text-muted-foreground"
                                >
                                    <DoorOpen class="size-3.5" />
                                    Open room
                                </div>
                            </button>
                        {:else}
                            <div
                                class="col-span-full rounded-lg border border-dashed p-10 text-center"
                            >
                                <p class="text-sm text-muted-foreground">No rooms found.</p>
                            </div>
                        {/each}
                    </section>
                {/if}
            {:else if tab === 'multiRooms'}
                {#if $multiRooms.length === 0}
                    <div class="flex h-[50vh] items-center justify-center">
                        <div class="max-w-sm text-center">
                            <div
                                class="mx-auto flex size-14 items-center justify-center rounded-full bg-muted"
                            >
                                <DoorOpen class="size-6 text-muted-foreground" />
                            </div>
                            <h2 class="mt-4 text-lg font-semibold">Create your first multi room</h2>
                            <p class="mt-2 text-sm text-muted-foreground">
                                Multi rooms are shared spaces with room-scoped content.
                            </p>
                            <Button class="mt-5 gap-2" onclick={() => (creatingMultiRoom = true)}>
                                <Plus class="size-4" />
                                New Multi Room
                            </Button>
                        </div>
                    </div>
                {:else}
                    <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {#each filteredMultiRooms() as room (room.id)}
                            {@const characterCount = Object.keys(room.characters.refs).length}
                            {@const chatCount = Object.keys(room.chats.refs).length}
                            <button
                                class="flex min-h-28 flex-col items-start rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50"
                                onclick={() => openMultiRoom(room.id)}
                            >
                                <div class="flex w-full items-center gap-3">
                                    <div
                                        class="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold"
                                    >
                                        {initial(room.name)}
                                    </div>
                                    <div class="min-w-0">
                                        <h2 class="truncate text-sm font-semibold">{room.name}</h2>
                                        <p class="mt-0.5 truncate text-xs text-muted-foreground">
                                            {characterCount} characters / {chatCount} chats
                                        </p>
                                    </div>
                                </div>
                                <div
                                    class="mt-auto flex items-center gap-1 pt-5 text-xs text-muted-foreground"
                                >
                                    <DoorOpen class="size-3.5" />
                                    Open multi room
                                </div>
                            </button>
                        {:else}
                            <div
                                class="col-span-full rounded-lg border border-dashed p-10 text-center"
                            >
                                <p class="text-sm text-muted-foreground">No multi rooms found.</p>
                            </div>
                        {/each}
                    </section>
                {/if}
            {:else if tab === 'characters'}
                {#if $characters.length === 0}
                    <div class="flex h-[50vh] items-center justify-center">
                        <div class="max-w-sm text-center">
                            <div
                                class="mx-auto flex size-14 items-center justify-center rounded-full bg-muted"
                            >
                                <Sparkles class="size-6 text-muted-foreground" />
                            </div>
                            <h2 class="mt-4 text-lg font-semibold">Create your first character</h2>
                            <p class="mt-2 text-sm text-muted-foreground">
                                Characters are global resources you can add to rooms.
                            </p>
                            <Button class="mt-5 gap-2" onclick={() => (creatingCharacter = true)}>
                                <Plus class="size-4" />
                                New Character
                            </Button>
                        </div>
                    </div>
                {:else}
                    <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {#each filteredCharacters() as character (character.id)}
                            <button
                                class="flex min-h-32 flex-col items-start rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50"
                                onclick={() =>
                                    onNavigate({ view: 'characterStudio', charId: character.id })}
                            >
                                <div class="flex w-full items-center gap-3">
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
                                        <p class="mt-0.5 truncate text-xs text-muted-foreground">
                                            {character.description || 'No description'}
                                        </p>
                                    </div>
                                </div>
                                <div
                                    class="mt-auto flex items-center gap-1 pt-5 text-xs text-muted-foreground"
                                >
                                    <UserRound class="size-3.5" />
                                    Open studio
                                </div>
                            </button>
                        {:else}
                            <div
                                class="col-span-full rounded-lg border border-dashed p-10 text-center"
                            >
                                <p class="text-sm text-muted-foreground">No characters found.</p>
                            </div>
                        {/each}
                    </section>
                {/if}
            {:else if $personas.length === 0}
                <div class="flex h-[50vh] items-center justify-center">
                    <div class="max-w-sm text-center">
                        <div
                            class="mx-auto flex size-14 items-center justify-center rounded-full bg-muted"
                        >
                            <UserRound class="size-6 text-muted-foreground" />
                        </div>
                        <h2 class="mt-4 text-lg font-semibold">Create your first persona</h2>
                        <p class="mt-2 text-sm text-muted-foreground">
                            Personas are user speakers you can attach to chats.
                        </p>
                        <Button class="mt-5 gap-2" onclick={() => (creatingPersona = true)}>
                            <Plus class="size-4" />
                            New Persona
                        </Button>
                    </div>
                </div>
            {:else}
                <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {#each filteredPersonas() as persona (persona.id)}
                        <button
                            class="flex min-h-32 flex-col items-start rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50"
                            onclick={() =>
                                onNavigate({
                                    view: 'personaStudio',
                                    personaId: persona.id
                                })}
                        >
                            <div class="flex w-full items-center gap-3">
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
                                    <p class="mt-0.5 truncate text-xs text-muted-foreground">
                                        {persona.description || 'No description'}
                                    </p>
                                </div>
                            </div>
                            <div
                                class="mt-auto flex items-center gap-1 pt-5 text-xs text-muted-foreground"
                            >
                                <UserRound class="size-3.5" />
                                Open studio
                            </div>
                        </button>
                    {:else}
                        <div class="col-span-full rounded-lg border border-dashed p-10 text-center">
                            <p class="text-sm text-muted-foreground">No personas found.</p>
                        </div>
                    {/each}
                </section>
            {/if}
        </div>
    </main>
</div>
