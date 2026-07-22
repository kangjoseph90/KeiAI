<script lang="ts">
    import { Button } from '$lib/components/ui/button';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
    import { MoreVertical, Languages, Pencil, GitBranch, Trash2 } from 'lucide-svelte';

    let {
        disabled = false,
        busyAction = null,
        hasTranslation = false,
        onRetranslate = () => {},
        onEditTranslation = () => {},
        onFork = () => {},
        onDelete = () => {}
    }: {
        disabled?: boolean;
        busyAction?: 'save' | 'delete' | 'swipe' | 'fork' | null;
        hasTranslation?: boolean;
        onRetranslate?: () => void;
        onEditTranslation?: () => void;
        onFork?: () => void;
        onDelete?: () => void;
    } = $props();
</script>

<DropdownMenu.Root>
    <DropdownMenu.Trigger>
        <Button
            variant="ghost"
            size="sm"
            class="relative size-8 px-0 text-muted-foreground after:absolute after:-inset-1 after:content-['']"
            aria-label="More message actions"
            {disabled}
        >
            <MoreVertical class="size-3.5" />
        </Button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" sideOffset={4} class="w-44">
        {#if hasTranslation}
            <DropdownMenu.Item class="cursor-pointer" {disabled} onclick={onRetranslate}>
                <Languages class="size-4" />
                Retranslate
            </DropdownMenu.Item>
            <DropdownMenu.Item class="cursor-pointer" {disabled} onclick={onEditTranslation}>
                <Pencil class="size-4" />
                Edit translation
            </DropdownMenu.Item>
        {/if}
        <DropdownMenu.Item
            class="cursor-pointer"
            {disabled}
            aria-busy={busyAction === 'fork'}
            onclick={onFork}
        >
            <GitBranch class="size-4" />
            Fork chat
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item
            class="cursor-pointer"
            variant="destructive"
            {disabled}
            aria-busy={busyAction === 'delete'}
            onclick={onDelete}
        >
            <Trash2 class="size-4" />
            Delete
        </DropdownMenu.Item>
    </DropdownMenu.Content>
</DropdownMenu.Root>
