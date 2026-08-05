<script lang="ts">
    import { characters } from '$lib/stores';
    import type { Room } from '$lib/services';
    import AssetView from '$lib/components/AssetView.svelte';
    import { sortByRefs } from '$lib/utils/ordering';

    interface Props {
        room: Room;
        class?: string;
    }

    let { room, class: className = 'size-12' }: Props = $props();

    // Get the character IDs in this room
    const roomCharIds = $derived(() => {
        const refs = room.characters?.refs || {};
        return Object.keys(refs);
    });

    // Lookup the characters in the characters store
    const roomChars = $derived(() => {
        const ids = new Set(roomCharIds());
        const found = $characters.filter((character) => ids.has(character.id));
        const refs = room.characters?.refs || {};
        const sorted = sortByRefs(found, refs);
        return sorted.slice().sort((a, b) => (a.avatar ? 1 : 0) - (b.avatar ? 1 : 0));
    });

    function initial(name: string): string {
        return (name.trim().charAt(0) || '?').toUpperCase();
    }
</script>

<div class="relative flex items-center justify-center shrink-0 select-none {className}">
    {#if roomChars().length === 0}
        <!-- Fallback: Room Initials -->
        <div
            class="flex size-full items-center justify-center rounded-md bg-card text-sm font-semibold text-foreground border border-border ring-1 ring-black/10 dark:ring-white/15 shadow-xs"
        >
            {initial(room.name)}
        </div>
    {:else if roomChars().length === 1}
        <!-- Single Character Avatar -->
        {@const char = roomChars()[0]}
        <div
            class="flex size-full items-center justify-center overflow-hidden rounded-md bg-card text-sm font-semibold text-foreground border border-border ring-1 ring-black/10 dark:ring-white/15 shadow-xs"
        >
            {#if char.avatar}
                <AssetView
                    asset={{
                        scopeType: char.scopeType,
                        scopeId: char.scopeId,
                        ownerTable: 'characters',
                        ownerId: char.id,
                        hash: char.avatar.hash,
                        encKey: char.avatar.encKey,
                        mimeType: char.avatar.mimeType
                    }}
                    alt={char.name}
                    class="size-full object-cover"
                />
            {:else}
                {initial(char.name)}
            {/if}
        </div>
    {:else if roomChars().length === 2}
        <!-- Stack of 2 characters -->
        {@const char1 = roomChars()[0]}
        {@const char2 = roomChars()[1]}
        <div
            class="absolute left-[9%] right-[9%] top-0 bottom-[18%] z-10 rounded-md border border-border ring-1 ring-black/10 dark:ring-white/15 bg-card shadow-sm overflow-hidden flex items-center justify-center transition-all duration-300 group-hover:-translate-y-1 group-hover:-translate-x-0.5 group-hover:-rotate-6"
        >
            {#if char1.avatar}
                <AssetView
                    asset={{
                        scopeType: char1.scopeType,
                        scopeId: char1.scopeId,
                        ownerTable: 'characters',
                        ownerId: char1.id,
                        hash: char1.avatar.hash,
                        encKey: char1.avatar.encKey,
                        mimeType: char1.avatar.mimeType
                    }}
                    alt={char1.name}
                    class="size-full object-cover"
                />
            {:else}
                <span class="text-[10px] font-semibold">{initial(char1.name)}</span>
            {/if}
        </div>
        <div
            class="absolute left-[9%] right-[9%] top-[18%] bottom-0 z-20 rounded-md border border-border ring-1 ring-black/15 dark:ring-white/20 bg-card shadow-md overflow-hidden flex items-center justify-center transition-all duration-300 group-hover:translate-y-1 group-hover:translate-x-0.5 group-hover:rotate-6"
        >
            {#if char2.avatar}
                <AssetView
                    asset={{
                        scopeType: char2.scopeType,
                        scopeId: char2.scopeId,
                        ownerTable: 'characters',
                        ownerId: char2.id,
                        hash: char2.avatar.hash,
                        encKey: char2.avatar.encKey,
                        mimeType: char2.avatar.mimeType
                    }}
                    alt={char2.name}
                    class="size-full object-cover"
                />
            {:else}
                <span class="text-[10px] font-semibold">{initial(char2.name)}</span>
            {/if}
        </div>
    {:else}
        <!-- Stack of 3+ characters -->
        {@const char1 = roomChars()[0]}
        {@const char2 = roomChars()[1]}
        {@const char3 = roomChars()[2]}
        <div
            class="absolute left-[14%] right-[14%] top-0 bottom-[28%] z-10 rounded-md border border-border ring-1 ring-black/10 dark:ring-white/15 bg-card shadow-sm overflow-hidden flex items-center justify-center transition-all duration-300 group-hover:-translate-y-1.5 group-hover:-translate-x-0.5 group-hover:-rotate-12"
        >
            {#if char1.avatar}
                <AssetView
                    asset={{
                        scopeType: char1.scopeType,
                        scopeId: char1.scopeId,
                        ownerTable: 'characters',
                        ownerId: char1.id,
                        hash: char1.avatar.hash,
                        encKey: char1.avatar.encKey,
                        mimeType: char1.avatar.mimeType
                    }}
                    alt={char1.name}
                    class="size-full object-cover"
                />
            {:else}
                <span class="text-[9px] font-semibold">{initial(char1.name)}</span>
            {/if}
        </div>
        <div
            class="absolute left-[14%] right-[14%] top-[14%] bottom-[14%] z-20 rounded-md border border-border ring-1 ring-black/10 dark:ring-white/15 bg-card shadow-sm overflow-hidden flex items-center justify-center transition-all duration-300 group-hover:rotate-3"
        >
            {#if char2.avatar}
                <AssetView
                    asset={{
                        scopeType: char2.scopeType,
                        scopeId: char2.scopeId,
                        ownerTable: 'characters',
                        ownerId: char2.id,
                        hash: char2.avatar.hash,
                        encKey: char2.avatar.encKey,
                        mimeType: char2.avatar.mimeType
                    }}
                    alt={char2.name}
                    class="size-full object-cover"
                />
            {:else}
                <span class="text-[9px] font-semibold">{initial(char2.name)}</span>
            {/if}
        </div>
        {#if roomChars().length > 3}
            <div
                class="absolute left-[14%] right-[14%] top-[28%] bottom-0 z-30 rounded-md border border-border ring-1 ring-black/15 dark:ring-white/20 bg-card text-foreground shadow-md flex items-center justify-center text-[9px] font-bold transition-all duration-300 group-hover:translate-y-1.5 group-hover:translate-x-0.5 group-hover:-rotate-3"
            >
                +{roomChars().length - 2}
            </div>
        {:else}
            <div
                class="absolute left-[14%] right-[14%] top-[28%] bottom-0 z-30 rounded-md border border-border ring-1 ring-black/15 dark:ring-white/20 bg-card shadow-md overflow-hidden flex items-center justify-center transition-all duration-300 group-hover:translate-y-1.5 group-hover:translate-x-0.5 group-hover:-rotate-3"
            >
                {#if char3.avatar}
                    <AssetView
                        asset={{
                            scopeType: char3.scopeType,
                            scopeId: char3.scopeId,
                            ownerTable: 'characters',
                            ownerId: char3.id,
                            hash: char3.avatar.hash,
                            encKey: char3.avatar.encKey,
                            mimeType: char3.avatar.mimeType
                        }}
                        alt={char3.name}
                        class="size-full object-cover"
                    />
                {:else}
                    <span class="text-[9px] font-semibold">{initial(char3.name)}</span>
                {/if}
            </div>
        {/if}
    {/if}
</div>
