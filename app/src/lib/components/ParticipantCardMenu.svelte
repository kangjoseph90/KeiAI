<script lang="ts">
    import { MoreVertical, Pin, Settings, X } from 'lucide-svelte';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu';

    let {
        kind,
        name,
        isDefault,
        disabled = false,
        defaultDisabled = false,
        defaultBusy = false,
        removeBusy = false,
        onOpen,
        onSetDefault,
        onRemove
    }: {
        kind: 'character' | 'persona';
        name: string;
        isDefault: boolean;
        disabled?: boolean;
        defaultDisabled?: boolean;
        defaultBusy?: boolean;
        removeBusy?: boolean;
        onOpen: () => void;
        onSetDefault: () => void;
        onRemove: () => void;
    } = $props();

    const removeLabel = $derived(kind === 'character' ? 'Remove from room' : 'Remove from chat');
</script>

<div
    role="none"
    class="pointer-events-none absolute inset-0 z-10 lg:hidden"
    onclick={(event) => event.stopPropagation()}
>
    {#if isDefault}
        <span
            role="img"
            class="pointer-events-auto absolute -left-1 -top-1 flex size-5 items-center justify-center rounded-full bg-background text-primary shadow-sm ring-1 ring-border"
            title={`Default ${kind}`}
            aria-label={`${name} is the default ${kind}`}
        >
            <Pin class="size-3" />
        </span>
    {/if}

    <div class="pointer-events-auto absolute -right-1 -top-1">
        <DropdownMenu.Root>
            <DropdownMenu.Trigger>
                <button
                    type="button"
                    class="relative flex size-5 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm ring-1 ring-border after:absolute after:-inset-2 after:content-['']"
                    aria-label={`Actions for ${name}`}
                    {disabled}
                >
                    <MoreVertical class="size-3" />
                </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" sideOffset={4} class="w-44">
                <DropdownMenu.Item class="cursor-pointer" onclick={onOpen}>
                    <Settings class="size-4" />
                    Open studio
                </DropdownMenu.Item>
                {#if !isDefault}
                    <DropdownMenu.Item
                        class="cursor-pointer"
                        disabled={disabled || defaultDisabled}
                        aria-busy={defaultBusy}
                        onclick={onSetDefault}
                    >
                        <Pin class="size-4" />
                        Set default
                    </DropdownMenu.Item>
                {/if}
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                    class="cursor-pointer"
                    variant="destructive"
                    {disabled}
                    aria-busy={removeBusy}
                    onclick={onRemove}
                >
                    <X class="size-4" />
                    {removeLabel}
                </DropdownMenu.Item>
            </DropdownMenu.Content>
        </DropdownMenu.Root>
    </div>
</div>
