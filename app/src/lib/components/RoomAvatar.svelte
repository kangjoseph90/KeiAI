<script lang="ts">
    import { characters } from '$lib/stores';
    import type { Room } from '$lib/services';
    import MediaView from '$lib/components/MediaView.svelte';
    import { sortByRefs } from '$lib/utils/ordering';

    interface Props {
        room: Room;
        class?: string;
        initialClass?: string;
    }

    let {
        room,
        class: className = 'size-12',
        initialClass = 'text-sm font-semibold'
    }: Props = $props();

    const roomCharIds = $derived(() => Object.keys(room.characters?.refs || {}));

    const roomChars = $derived(() => {
        const ids = new Set(roomCharIds());
        const found = $characters.filter((character) => ids.has(character.id));
        const refs = room.characters?.refs || {};
        const sorted = sortByRefs(found, refs);
        return sorted.slice().sort((a, b) => (b.avatar ? 1 : 0) - (a.avatar ? 1 : 0));
    });

    function initial(name: string): string {
        return (name.trim().charAt(0) || '?').toUpperCase();
    }
</script>

<div class="relative flex shrink-0 select-none items-center justify-center {className}">
    {#if roomChars().length === 0}
        <div
            class="flex size-full items-center justify-center bg-muted text-foreground {initialClass}"
        >
            {initial(room.name)}
        </div>
    {:else}
        <div
            class="grid size-full overflow-hidden bg-muted {roomChars().length === 1
                ? 'grid-cols-1'
                : roomChars().length === 2
                  ? 'grid-cols-2'
                  : 'grid-cols-2 grid-rows-2'}"
        >
            {#each roomChars().slice(0, 3) as character, index (character.id)}
                <div
                    class="relative flex min-w-0 items-center justify-center overflow-hidden bg-card {initialClass} {roomChars()
                        .length >= 3 && index === 0
                        ? 'row-span-2'
                        : ''}"
                >
                    {#if character.avatar}
                        <MediaView
                            asset={{
                                scopeType: character.scopeType,
                                scopeId: character.scopeId,
                                ownerTable: 'characters',
                                ownerId: character.id,
                                hash: character.avatar.hash,
                                encKey: character.avatar.encKey,
                                mimeType: character.avatar.mimeType
                            }}
                            alt={character.name}
                            class="size-full object-cover"
                            focus="top"
                        />
                    {:else}
                        {initial(character.name)}
                    {/if}
                </div>
            {/each}
        </div>
    {/if}
</div>
