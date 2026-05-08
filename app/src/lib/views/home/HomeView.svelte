<script lang="ts">
    import { MessageSquare, Plus, Search, Sparkles } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { characters, createCharacter } from '$lib/stores';

    interface Props {
        onSelectCharacter: (characterId: string) => void;
    }

    let { onSelectCharacter }: Props = $props();

    let query = $state('');
    let creating = $state(false);
    let name = $state('');

    const filteredCharacters = $derived(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return $characters;
        return $characters.filter((character) => character.name.toLowerCase().includes(normalized));
    });

    async function handleCreateCharacter() {
        const trimmed = name.trim();
        if (!trimmed) return;

        const character = await createCharacter({
            name: trimmed,
            description: ''
        });
        name = '';
        creating = false;
        onSelectCharacter(character.id);
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
                    Choose a character to resume their latest chat.
                </p>
            </div>
            {#if creating}
                <form
                    class="flex w-full max-w-sm gap-2"
                    onsubmit={(event) => {
                        event.preventDefault();
                        handleCreateCharacter();
                    }}
                >
                    <Input bind:value={name} placeholder="Character name..." autofocus />
                    <Button type="submit">Create</Button>
                </form>
            {:else}
                <Button class="gap-2" onclick={() => (creating = true)}>
                    <Plus class="size-4" />
                    New Character
                </Button>
            {/if}
        </div>
    </header>

    <main class="flex-1 overflow-y-auto px-8 py-8">
        {#if $characters.length === 0}
            <div class="flex h-full items-center justify-center">
                <div class="max-w-sm text-center">
                    <div
                        class="mx-auto flex size-14 items-center justify-center rounded-full bg-muted"
                    >
                        <Sparkles class="size-6 text-muted-foreground" />
                    </div>
                    <h2 class="mt-4 text-lg font-semibold">Create your first character</h2>
                    <p class="mt-2 text-sm text-muted-foreground">
                        KeiAI starts from a character, then keeps each character's chats together.
                    </p>
                    <Button class="mt-5 gap-2" onclick={() => (creating = true)}>
                        <Plus class="size-4" />
                        New Character
                    </Button>
                </div>
            </div>
        {:else}
            <div class="mx-auto max-w-6xl space-y-6">
                <div class="relative max-w-md">
                    <Search
                        class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input bind:value={query} placeholder="Search characters..." class="pl-9" />
                </div>

                <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {#each filteredCharacters() as character (character.id)}
                        <button
                            class="flex min-h-32 flex-col items-start rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50"
                            onclick={() => onSelectCharacter(character.id)}
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
                                <MessageSquare class="size-3.5" />
                                Open latest chat
                            </div>
                        </button>
                    {:else}
                        <div class="col-span-full rounded-lg border border-dashed p-10 text-center">
                            <p class="text-sm text-muted-foreground">No characters found.</p>
                        </div>
                    {/each}
                </section>
            </div>
        {/if}
    </main>
</div>
