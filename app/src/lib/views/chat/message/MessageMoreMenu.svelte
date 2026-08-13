<script lang="ts">
    import { Button } from '$lib/components/ui/button';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
    import {
        AudioLines,
        Copy,
        GitBranch,
        ImageIcon,
        Languages,
        Loader2,
        MoreVertical,
        Pencil,
        Trash2
    } from 'lucide-svelte';
    import type { DisplayMessage } from '$lib/stores';
    import { imageGenerationTasks, ttsTasks, t } from '$lib/stores';
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
    type TranslationAction = 'translate' | 'show-translation' | 'show-original' | 'stop';

    interface Props {
        message: DisplayMessage;
        busyAction?: MessageAction | null;
        open?: boolean;
        mode?: 'default' | 'long-press-user';
        customAnchor?: HTMLElement | null;
        translationAction?: TranslationAction;
        onCopy?: () => void;
        onTranslationAction?: () => void;
        onEdit?: () => void;
        onEditTranslation: () => void;
        onFork: () => void;
        onDelete: () => void;
    }

    let {
        message,
        busyAction = null,
        open = $bindable(false),
        mode = 'default',
        customAnchor = null,
        translationAction = 'translate',
        onCopy,
        onTranslationAction,
        onEdit,
        onEditTranslation,
        onFork,
        onDelete
    }: Props = $props();

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
                title: $t('chat.toast.startImage'),
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
                title: $t('chat.toast.startTts'),
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
                title: $t('chat.toast.startTranslation'),
                description: getErrorMessage(error)
            });
        }
    }
</script>

<DropdownMenu.Root bind:open>
    <DropdownMenu.Trigger>
        <Button
            variant="ghost"
            size="sm"
            class={mode === 'long-press-user'
                ? 'pointer-events-none absolute right-0 bottom-0 size-px overflow-hidden p-0 opacity-0'
                : "relative size-8 px-0 text-muted-foreground after:absolute after:-inset-1 after:content-['']"}
            title={$t('chat.message.moreActions')}
            aria-label={$t('chat.message.moreActions')}
            aria-hidden={mode === 'long-press-user'}
            tabindex={mode === 'long-press-user' ? -1 : undefined}
            {disabled}
        >
            <MoreVertical class="size-3.5" />
        </Button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Content
        align="end"
        sideOffset={4}
        {customAnchor}
        class="w-52 max-w-[calc(100vw-1rem)]"
        onCloseAutoFocus={(e) => e.preventDefault()}
    >
        {#if mode === 'long-press-user'}
            <DropdownMenu.Item class="cursor-pointer" {disabled} onclick={onCopy}>
                <Copy class="size-4" />
                {$t('chat.message.copy')}
            </DropdownMenu.Item>
            <DropdownMenu.Item class="cursor-pointer" {disabled} onclick={onTranslationAction}>
                {#if translationAction === 'stop'}
                    <Loader2 class="size-4 animate-spin" />
                    {$t('chat.message.translation.stop')}
                {:else}
                    <Languages class="size-4" />
                    {#if translationAction === 'show-translation'}
                        {$t('chat.message.translation.showTranslationTitle')}
                    {:else if translationAction === 'show-original'}
                        {$t('chat.message.translation.showOriginalTitle')}
                    {:else}
                        {$t('chat.message.translation.translateTitle')}
                    {/if}
                {/if}
            </DropdownMenu.Item>
            <DropdownMenu.Item class="cursor-pointer" {disabled} onclick={onEdit}>
                <Pencil class="size-4" />
                {$t('chat.message.edit')}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
        {:else if message.role !== 'user'}
            <DropdownMenu.Item
                class="cursor-pointer whitespace-nowrap"
                {disabled}
                onclick={() => void handleImageTask()}
            >
                {#if imageTaskStatus === 'generating'}
                    <Loader2 class="size-4 animate-spin" />
                    {$t('chat.message.more.stopImage')}
                {:else}
                    <ImageIcon class="size-4" />
                    {hasImageAttachments
                        ? $t('chat.message.more.regenerateImage')
                        : $t('chat.message.more.generateImage')}
                {/if}
            </DropdownMenu.Item>
            <DropdownMenu.Item
                class="cursor-pointer whitespace-nowrap"
                {disabled}
                onclick={() => void handleAudioTask()}
            >
                {#if audioTaskStatus === 'generating'}
                    <Loader2 class="size-4 animate-spin" />
                    {$t('chat.message.more.stopAudio')}
                {:else}
                    <AudioLines class="size-4" />
                    {hasAudioAttachments
                        ? $t('chat.message.more.regenerateAudio')
                        : $t('chat.message.more.generateAudio')}
                {/if}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
        {/if}
        {#if hasTranslation}
            <DropdownMenu.Item
                class="cursor-pointer"
                {disabled}
                onclick={() => void handleTranslationTask()}
            >
                <Languages class="size-4" />
                {$t('chat.message.more.retranslate')}
            </DropdownMenu.Item>
            <DropdownMenu.Item class="cursor-pointer" {disabled} onclick={onEditTranslation}>
                <Pencil class="size-4" />
                {$t('chat.message.more.editTranslation')}
            </DropdownMenu.Item>
        {/if}
        <DropdownMenu.Item
            class="cursor-pointer"
            {disabled}
            aria-busy={busyAction === 'fork'}
            onclick={onFork}
        >
            <GitBranch class="size-4" />
            {$t('chat.message.more.forkChat')}
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
            {$t('chat.message.more.delete')}
        </DropdownMenu.Item>
    </DropdownMenu.Content>
</DropdownMenu.Root>
