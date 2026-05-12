<script lang="ts">
    import { DoorOpen, Plus, Search, Sparkles, UserRound } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { characters, createCharacter, createRoom, rooms } from '$lib/stores';
    import type { RouteState } from '$lib/router';

    interface Props {
        onNavigate: (route: RouteState) => void;
    }

    let { onNavigate }: Props = $props();

    type Tab = 'rooms' | 'characters';
    let tab = $state<Tab>('rooms');
    let query = $state('');
    let creatingRoom = $state(false);
    let creatingCharacter = $state(false);
    let roomName = $state('');
    let characterName = $state('');

    const filteredRooms = $derived(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return $rooms;
        return $rooms.filter((room) => room.name.toLowerCase().includes(normalized));
    });

    const filteredCharacters = $derived(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return $characters;
        return $characters.filter((character) => character.name.toLowerCase().includes(normalized));
    });

    async function handleCreateRoom() {
        const trimmed = roomName.trim();
        if (!trimmed) return;

        const room = await createRoom({ name: trimmed });
        roomName = '';
        creatingRoom = false;
        onNavigate({ view: 'room', roomId: room.id });
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
                    Open a room for conversations, or edit character blueprints.
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
            {:else if creatingCharacter}
                <form
                    class="flex w-full max-w-sm gap-2"
                    onsubmit={(event) => {
                        event.preventDefault();
                        handleCreateCharacter();
                    }}
                >
                    <Input bind:value={characterName} placeholder="Character name..." autofocus />
                    <Button type="submit">Create</Button>
                </form>
            {:else}
                <Button class="gap-2" onclick={() => (creatingCharacter = true)}>
                    <Plus class="size-4" />
                    New Character
                </Button>
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
                        'characters'
                            ? 'bg-background shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'}"
                        onclick={() => (tab = 'characters')}
                    >
                        Characters
                    </button>
                </div>

                <div class="relative w-full max-w-md">
                    <Search
                        class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                        bind:value={query}
                        placeholder={tab === 'rooms' ? 'Search rooms...' : 'Search characters...'}
                        class="pl-9"
                    />
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
            {:else if $characters.length === 0}
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
                        <div class="col-span-full rounded-lg border border-dashed p-10 text-center">
                            <p class="text-sm text-muted-foreground">No characters found.</p>
                        </div>
                    {/each}
                </section>
            {/if}
        </div>
    </main>
</div>
