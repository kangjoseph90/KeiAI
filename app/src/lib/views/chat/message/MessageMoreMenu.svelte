<script lang="ts">
    import { Button } from '$lib/components/ui/button';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
    import {
        AudioLines,
        GitBranch,
        ImageIcon,
        Languages,
        Loader2,
        MoreVertical,
        Pencil,
        Trash2
    } from 'lucide-svelte';
    import type { TaskStatus } from '$lib/stores';

    let {
        disabled = false,
        busyAction = null,
        hasTranslation = false,
        hasImageAttachments = false,
        hasAudioAttachments = false,
        imageTaskStatus,
        audioTaskStatus,
        onGenerateImage = () => {},
        onGenerateAudio = () => {},
        onRetranslate = () => {},
        onEditTranslation = () => {},
        onFork = () => {},
        onDelete = () => {}
    }: {
        disabled?: boolean;
        busyAction?: 'save' | 'delete' | 'swipe' | 'fork' | null;
        hasTranslation?: boolean;
        hasImageAttachments?: boolean;
        hasAudioAttachments?: boolean;
        imageTaskStatus?: TaskStatus;
        audioTaskStatus?: TaskStatus;
        onGenerateImage?: () => void;
        onGenerateAudio?: () => void;
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
        <DropdownMenu.Item class="cursor-pointer" {disabled} onclick={onGenerateImage}>
            {#if imageTaskStatus === 'generating'}
                <Loader2 class="size-4 animate-spin" />
                Stop image generation
            {:else}
                <ImageIcon class="size-4" />
                {hasImageAttachments ? 'Regenerate image' : 'Generate image'}
            {/if}
        </DropdownMenu.Item>
        <DropdownMenu.Item class="cursor-pointer" {disabled} onclick={onGenerateAudio}>
            {#if audioTaskStatus === 'generating'}
                <Loader2 class="size-4 animate-spin" />
                Stop audio generation
            {:else}
                <AudioLines class="size-4" />
                {hasAudioAttachments ? 'Regenerate audio' : 'Generate audio'}
            {/if}
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
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
