<script lang="ts">
    import { MoreVertical, Pin, Settings, X } from 'lucide-svelte';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
    import { Button } from '$lib/components/ui/button';
    import { t } from '$lib/stores';

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

    const removeLabel = $derived(
        kind === 'character'
            ? $t('components.participantMenu.removeFromRoom')
            : $t('components.participantMenu.removeFromChat')
    );
    let menuOpen = $state(false);
</script>

<div
    role="none"
    class="pointer-events-none absolute inset-0 z-10"
    onclick={(event) => event.stopPropagation()}
>
    <div
        class="pointer-events-auto absolute right-1 top-1 touch-visible opacity-0 transition-opacity group-hover:opacity-100 has-focus-visible:opacity-100 {menuOpen
            ? 'opacity-100'
            : ''}"
    >
        <DropdownMenu.Root bind:open={menuOpen}>
            <DropdownMenu.Trigger>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    class="size-6 rounded-full border border-border/60 bg-background/85 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-background hover:text-foreground dark:hover:bg-background/95"
                    aria-label={$t('components.participantMenu.actionsFor', { name })}
                    {disabled}
                >
                    <MoreVertical class="size-3.5" />
                </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" sideOffset={4} class="w-44">
                <DropdownMenu.Item class="cursor-pointer" onclick={onOpen}>
                    <Settings class="size-4" />
                    {$t('components.participantMenu.openStudio')}
                </DropdownMenu.Item>
                {#if !isDefault}
                    <DropdownMenu.Item
                        class="cursor-pointer"
                        disabled={disabled || defaultDisabled}
                        aria-busy={defaultBusy}
                        onclick={onSetDefault}
                    >
                        <Pin class="size-4" />
                        {$t('components.participantMenu.setDefault')}
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
