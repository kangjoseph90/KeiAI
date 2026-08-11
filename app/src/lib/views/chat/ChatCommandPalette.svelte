<script lang="ts">
    import type { ResolvedChatCommand } from '$lib/types/command';
    import { t } from '$lib/stores';

    let {
        commands,
        selectedIndex,
        onSelect
    }: {
        commands: ResolvedChatCommand[];
        selectedIndex: number;
        onSelect: (command: ResolvedChatCommand) => void;
    } = $props();
</script>

<div
    class="absolute inset-x-0 bottom-full z-30 mb-2 max-h-72 overflow-y-auto rounded-2xl border border-border/80 bg-popover/95 p-1.5 text-popover-foreground shadow-xl backdrop-blur-xl"
    role="listbox"
    aria-label={$t('chat.commandPalette.region')}
>
    {#each commands as resolved, index (`${resolved.owner.type}:${resolved.owner.id}:${resolved.command.id}`)}
        {@const command = resolved.command}
        <button
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            class="block w-full rounded-xl px-3 py-2 text-left transition-colors {index ===
            selectedIndex
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/60'}"
            onmousedown={(event) => event.preventDefault()}
            onclick={() => onSelect(resolved)}
        >
            <span class="flex min-w-0 items-baseline justify-between gap-4">
                <span class="min-w-0 truncate font-mono text-sm font-medium">
                    /{command.name}
                </span>
                <span
                    class="max-w-[45%] shrink-0 truncate text-right text-xs text-muted-foreground"
                >
                    {resolved.ownerName}
                </span>
            </span>
            {#if command.description}
                <span class="mt-0.5 block truncate text-xs text-muted-foreground">
                    {command.description}
                </span>
            {/if}
        </button>
    {/each}
</div>
