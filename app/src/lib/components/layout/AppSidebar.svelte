<script lang="ts">
    /**
     * AppSidebar — RisuAI-style character list sidebar.
     * Shows all characters, clicking one opens the latest chat directly.
     */
    import { Settings, Plus, PanelLeftClose, PanelLeft, Search } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
    import * as Avatar from '$lib/components/ui/avatar';
    import {
        characters,
        activeUser,
        userEmail,
        createCharacter,
        updateCharacter,
        deleteCharacter
    } from '$lib/stores';
    import type { RouteState } from '$lib/router';

    let {
        collapsed = false,
        route,
        onToggle,
        onNavigate,
        onOpenSettings
    }: {
        collapsed?: boolean;
        route: RouteState;
        onToggle: () => void;
        onNavigate: (r: RouteState) => void;
        onOpenSettings: () => void;
    } = $props();

    let searchText = $state('');
    let editingId = $state<string | null>(null);
    let editingName = $state('');
    let newCharName = $state('');
    let showNewChar = $state(false);

    let filteredCharacters = $derived(
        searchText.trim()
            ? $characters.filter((c) => c.name.toLowerCase().includes(searchText.toLowerCase()))
            : $characters
    );

    async function handleSelectChar(charId: string) {
        onNavigate({ view: 'chat', charId });
    }

    async function handleCreateChar() {
        if (!newCharName.trim()) return;
        const char = await createCharacter({
            name: newCharName,
            shortDescription: 'A new character'
        });
        newCharName = '';
        showNewChar = false;
        onNavigate({ view: 'chat', charId: char.id });
    }

    async function handleRename(id: string) {
        if (!editingName.trim()) return;
        await updateCharacter(id, { name: editingName });
        editingId = null;
    }

    function startEdit(id: string, name: string) {
        editingId = id;
        editingName = name;
    }
</script>

<aside
    class="flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 {collapsed
        ? 'w-14'
        : 'w-64'}"
>
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-sidebar-border px-3 py-3">
        {#if !collapsed}
            <span class="text-sm font-bold tracking-tight">KeiAI</span>
        {/if}
        <Button variant="ghost" size="sm" class="h-7 w-7 p-0" onclick={onToggle}>
            {#if collapsed}
                <PanelLeft class="size-4" />
            {:else}
                <PanelLeftClose class="size-4" />
            {/if}
        </Button>
    </div>

    {#if !collapsed}
        <!-- Search -->
        <div class="px-3 py-2">
            <div class="relative">
                <Search
                    class="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                    bind:value={searchText}
                    placeholder="Search characters..."
                    class="h-8 pl-8 text-xs"
                />
            </div>
        </div>
    {/if}

    <!-- Character List -->
    <div class="flex-1 overflow-y-auto">
        {#if !collapsed}
            <div class="flex flex-col gap-0.5 px-2">
                {#each filteredCharacters as char (char.id)}
                    {@const isActive = route.charId === char.id}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        class="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors cursor-pointer {isActive
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                            : 'hover:bg-sidebar-accent/50'}"
                        onclick={() => handleSelectChar(char.id)}
                    >
                        <div class="flex-1 overflow-hidden">
                            {#if editingId === char.id}
                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                <div class="flex gap-1" onclick={(e) => e.stopPropagation()}>
                                    <Input
                                        bind:value={editingName}
                                        class="h-6 flex-1 text-xs"
                                        onkeydown={(e) => {
                                            if (e.key === 'Enter') handleRename(char.id);
                                            if (e.key === 'Escape') editingId = null;
                                        }}
                                    />
                                </div>
                            {:else}
                                <span class="truncate block">{char.name}</span>
                            {/if}
                        </div>

                        <!-- Hover actions -->
                        {#if isActive && editingId !== char.id}
                            <div
                                class="hidden group-hover:flex gap-0.5"
                                onclick={(e) => e.stopPropagation()}
                            >
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    class="h-5 w-5 p-0"
                                    onclick={() => startEdit(char.id, char.name)}
                                >
                                    <span class="text-[10px]">E</span>
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    class="h-5 w-5 p-0 text-destructive"
                                    onclick={() => deleteCharacter(char.id)}
                                >
                                    <span class="text-[10px]">X</span>
                                </Button>
                            </div>
                        {/if}
                    </div>
                {/each}
            </div>

            <!-- New Character -->
            <div class="px-2 pt-2">
                {#if showNewChar}
                    <form
                        class="flex gap-1"
                        onsubmit={(e) => {
                            e.preventDefault();
                            handleCreateChar();
                        }}
                    >
                        <Input
                            bind:value={newCharName}
                            placeholder="Name..."
                            class="h-7 flex-1 text-xs"
                            autofocus
                        />
                        <Button type="submit" size="sm" class="h-7 px-2 text-xs">Create</Button>
                    </form>
                {:else}
                    <Button
                        variant="ghost"
                        size="sm"
                        class="w-full justify-start gap-2 text-xs text-muted-foreground"
                        onclick={() => (showNewChar = true)}
                    >
                        <Plus class="size-3.5" /> New Character
                    </Button>
                {/if}
            </div>
        {:else}
            <!-- Collapsed: just icons with tooltips -->
            <div class="flex flex-col items-center gap-1 py-2">
                {#each $characters.slice(0, 10) as char (char.id)}
                    {@const isActive = route.charId === char.id}
                    <button
                        class="flex size-9 items-center justify-center rounded-md text-xs font-medium transition-colors {isActive
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                            : 'hover:bg-sidebar-accent/50 text-muted-foreground'}"
                        title={char.name}
                        onclick={() => handleSelectChar(char.id)}
                    >
                        {char.name.charAt(0).toUpperCase()}
                    </button>
                {/each}
                <button
                    class="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/50"
                    title="New Character"
                    onclick={() => (showNewChar = true)}
                >
                    <Plus class="size-4" />
                </button>
            </div>
        {/if}
    </div>

    <!-- Bottom Section -->
    <div class="border-t border-sidebar-border">
        <!-- Settings Button -->
        <div class="px-2 py-1">
            <Button
                variant="ghost"
                size="sm"
                class="w-full justify-start gap-2 text-xs {collapsed ? 'px-0 justify-center' : ''}"
                onclick={onOpenSettings}
            >
                <Settings class="size-4" />
                {#if !collapsed}Settings{/if}
            </Button>
        </div>

        <!-- User Profile -->
        {#if !collapsed}
            <div class="px-2 pb-2">
                <div
                    class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/50"
                >
                    <Avatar.Root class="size-7 shrink-0">
                        <Avatar.Image src={$activeUser?.avatar} alt={$activeUser?.name ?? 'User'} />
                        <Avatar.Fallback
                            >{($activeUser?.name ?? 'U').charAt(0).toUpperCase()}</Avatar.Fallback
                        >
                    </Avatar.Root>
                    <div class="flex flex-col overflow-hidden">
                        <span class="text-xs font-medium truncate"
                            >{$activeUser?.name ?? 'Local User'}</span
                        >
                        <span class="text-[10px] text-muted-foreground truncate"
                            >{$userEmail ?? 'Offline'}</span
                        >
                    </div>
                </div>
            </div>
        {/if}
    </div>
</aside>
