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
    import type { DisplayMessage } from '$lib/stores';
    import { imageGenerationTasks, ttsTasks } from '$lib/stores';
    import {
        runImageGeneration,
        runTTS,
        runTranslation,
        stopImageGeneration,
        stopTTS
    } from '$lib/tasks';
    import { toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    type MessageAction = 'save' | 'delete' | 'swipe' | 'fork';

    interface Props {
        message: DisplayMessage;
        busyAction?: MessageAction | null;
        onEditTranslation: () => void;
        onFork: () => void;
        onDelete: () => void;
    }

    let { message, busyAction = null, onEditTranslation, onFork, onDelete }: Props = $props();

    let disabled = $derived(busyAction !== null);
    let activeSwipe = $derived(message.swipes[message.activeSwipeId]);
    let hasTranslation = $derived(Boolean(activeSwipe?.translation));
    let hasImageAttachments = $derived((activeSwipe?.imageAttachments?.length ?? 0) > 0);
    let hasAudioAttachments = $derived((activeSwipe?.audioAttachments?.length ?? 0) > 0);
    let imageTaskStatus = $derived($imageGenerationTasks.get(message.id)?.status);
    let audioTaskStatus = $derived($ttsTasks.get(message.id)?.status);

    async function handleImageTask(): Promise<void> {
        if (imageTaskStatus === 'generating') {
            stopImageGeneration(message.id);
            return;
        }
        try {
            await runImageGeneration(message.id);
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            toast.error({
                title: 'Could not start image generation',
                description: getErrorMessage(error)
            });
        }
    }

    async function handleAudioTask(): Promise<void> {
        if (audioTaskStatus === 'generating') {
            stopTTS(message.id);
            return;
        }
        try {
            await runTTS(message.id);
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            toast.error({
                title: 'Could not start text to speech',
                description: getErrorMessage(error)
            });
        }
    }

    async function handleTranslationTask(): Promise<void> {
        try {
            await runTranslation(message.id, { force: hasTranslation });
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            toast.error({
                title: 'Could not start translation',
                description: getErrorMessage(error)
            });
        }
    }
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
    <DropdownMenu.Content
        align="end"
        sideOffset={4}
        class="w-52 max-w-[calc(100vw-1rem)]"
        onCloseAutoFocus={(e) => e.preventDefault()}
    >
        <DropdownMenu.Item
            class="cursor-pointer whitespace-nowrap"
            {disabled}
            onclick={() => void handleImageTask()}
        >
            {#if imageTaskStatus === 'generating'}
                <Loader2 class="size-4 animate-spin" />
                Stop image generation
            {:else}
                <ImageIcon class="size-4" />
                {hasImageAttachments ? 'Regenerate image' : 'Generate image'}
            {/if}
        </DropdownMenu.Item>
        <DropdownMenu.Item
            class="cursor-pointer whitespace-nowrap"
            {disabled}
            onclick={() => void handleAudioTask()}
        >
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
            <DropdownMenu.Item
                class="cursor-pointer"
                {disabled}
                onclick={() => void handleTranslationTask()}
            >
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
