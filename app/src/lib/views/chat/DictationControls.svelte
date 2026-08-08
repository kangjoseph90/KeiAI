<script lang="ts">
    import { Loader2, Square, X } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import type { DictationTask } from '$lib/stores';
    import TaskErrorNotice from './TaskErrorNotice.svelte';

    let {
        task,
        onCancel,
        onFinish,
        onDismiss,
        class: className = ''
    }: {
        task: DictationTask;
        onCancel: () => void;
        onFinish: () => void;
        onDismiss: () => void;
        class?: string;
    } = $props();
</script>

{#if task.phase === 'error'}
    <TaskErrorNotice
        title="Dictation failed"
        message={task.errorMessage ?? 'Unknown error'}
        {onDismiss}
        class={className}
    />
{:else}
    <div class="flex min-w-0 items-center gap-2">
        <Button
            variant="ghost"
            size="icon"
            class="shrink-0 rounded-full"
            onclick={onCancel}
            title="Cancel dictation"
            aria-label="Cancel dictation"
        >
            <X class="size-4" />
        </Button>

        {#if task.phase === 'recording'}
            <div
                class="flex h-9 min-w-0 flex-1 items-center justify-end gap-0.5 overflow-hidden"
                aria-label="Recording audio"
            >
                {#each task.levels as level, index (`${index}-${task.levels.length}`)}
                    <span
                        class="w-0.75 shrink-0 rounded-full bg-muted-foreground/70 transition-[height] duration-75"
                        style:height={`${Math.max(3, Math.round(level * 28))}px`}
                    ></span>
                {/each}
            </div>
            <Button
                variant="secondary"
                size="icon"
                class="shrink-0 rounded-full"
                onclick={onFinish}
                title="Stop and transcribe"
                aria-label="Stop and transcribe"
            >
                <Square class="size-3.5 fill-current" />
            </Button>
        {:else}
            <div
                class="flex h-9 min-w-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
                role="status"
            >
                <Loader2 class="size-4 animate-spin" />
                <span>Transcribing…</span>
            </div>
        {/if}
    </div>
{/if}
