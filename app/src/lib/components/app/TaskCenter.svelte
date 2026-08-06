<script lang="ts">
    import { AlertCircle, CheckCircle2, Loader2, Mic, Search, Square, X } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { collectedTasks, type CollectedTask } from '$lib/stores';
    import { navigate } from '$lib/router';
    import {
        cancelDictation,
        dismissChat,
        dismissDictation,
        dismissImageGeneration,
        dismissTranslation,
        dismissTTS,
        finishDictation,
        stopChat,
        stopImageGeneration,
        stopTranslation,
        stopTTS
    } from '$lib/tasks';

    let expanded = $state(false);

    const visibleTasks = $derived([...$collectedTasks].sort(compareTasks));
    const taskSummary = $derived.by(() => {
        let errors = 0;
        let recordings = 0;
        let running = 0;
        let completed = 0;

        for (const task of visibleTasks) {
            if (task.status === 'error') errors += 1;
            else if (task.status === 'completed') completed += 1;
            else if (task.kind === 'dictation' && task.phase === 'recording') recordings += 1;
            else running += 1;
        }

        return { errors, recordings, running, completed };
    });
    const taskCenterLabel = $derived(
        `Task Center: ${visibleTasks.length} task${visibleTasks.length === 1 ? '' : 's'}, ${taskSummary.errors} failed, ${taskSummary.recordings} recording, ${taskSummary.running} running, ${taskSummary.completed} completed`
    );

    function taskPriority(task: CollectedTask): number {
        if (task.status === 'error') return 0;
        if (task.kind === 'dictation' && task.phase === 'recording') return 1;
        if (task.status === 'running') return 2;
        return 3;
    }

    function compareTasks(a: CollectedTask, b: CollectedTask): number {
        return taskPriority(a) - taskPriority(b) || b.startedAt - a.startedAt;
    }

    function openTaskChat(task: CollectedTask): void {
        navigate({ view: 'room', roomId: task.roomId, chatId: task.chatId });
    }

    function cancelTask(task: CollectedTask): void {
        switch (task.kind) {
            case 'chat':
                stopChat(task.chatId);
                break;
            case 'dictation':
                cancelDictation(task.chatId);
                break;
            case 'translation':
                stopTranslation(task.taskKey);
                break;
            case 'tts':
                stopTTS(task.taskKey);
                break;
            case 'image':
                stopImageGeneration(task.taskKey);
                break;
        }
    }

    function dismissTask(task: CollectedTask): void {
        switch (task.kind) {
            case 'chat':
                dismissChat(task.chatId);
                break;
            case 'dictation':
                dismissDictation(task.chatId);
                break;
            case 'translation':
                dismissTranslation(task.taskKey);
                break;
            case 'tts':
                dismissTTS(task.taskKey);
                break;
            case 'image':
                dismissImageGeneration(task.taskKey);
                break;
        }
    }
</script>

{#if visibleTasks.length > 0}
    <div
        class="pointer-events-none fixed top-4 right-4 z-60 flex w-[min(24rem,calc(100vw-2rem))] flex-col items-end"
    >
        <Button
            variant="outline"
            size="icon-lg"
            class="pointer-events-auto relative rounded-full bg-background/95 shadow-lg backdrop-blur-xl"
            onclick={() => (expanded = !expanded)}
            aria-label={taskCenterLabel}
            aria-expanded={expanded}
            title={expanded ? 'Collapse Task Center' : 'Expand Task Center'}
        >
            {#if taskSummary.errors > 0}
                <AlertCircle class="size-5 text-destructive" />
            {:else if taskSummary.recordings > 0}
                <Mic class="size-5 text-destructive" />
            {:else if taskSummary.running > 0}
                <Loader2 class="size-5 animate-spin text-primary" />
            {:else}
                <CheckCircle2 class="size-5 text-emerald-500" />
            {/if}
            <span
                class="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background shadow-sm"
                aria-hidden="true"
            >
                {visibleTasks.length > 9 ? '9+' : visibleTasks.length}
            </span>
        </Button>

        {#if expanded}
            <aside
                class="pointer-events-auto mt-2 flex max-h-[min(32rem,calc(100dvh-5rem))] w-full origin-top-right animate-in flex-col overflow-hidden rounded-xl border border-border/80 bg-background/95 shadow-xl fade-in-0 zoom-in-95 backdrop-blur-xl duration-150"
                aria-label="Task Center tasks"
            >
                <div class="flex min-h-0 flex-col divide-y overflow-y-auto" aria-live="polite">
                    {#each visibleTasks as task (task.id)}
                        <section class="p-3">
                            <div class="mb-2 flex min-w-0 items-center gap-2">
                                <span class="min-w-0 flex-1 truncate text-xs font-medium">
                                    {task.chatTitle || 'Untitled Chat'}
                                </span>
                                <span class="shrink-0 text-[10px] text-muted-foreground">
                                    {task.title}
                                </span>
                            </div>

                            <div class="flex min-h-8 items-center gap-2">
                                {#if task.status === 'error'}
                                    <AlertCircle class="size-4 shrink-0 text-destructive" />
                                    <span
                                        class="min-w-0 flex-1 text-sm font-medium text-destructive"
                                    >
                                        Failed
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        onclick={() => openTaskChat(task)}
                                        aria-label={`Open ${task.chatTitle || 'Untitled Chat'}`}
                                        title="Open chat"
                                    >
                                        <Search class="size-3.5" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        onclick={() => dismissTask(task)}
                                        aria-label={`Dismiss ${task.title}`}
                                        title="Dismiss"
                                    >
                                        <X class="size-3.5" />
                                    </Button>
                                {:else if task.status === 'completed'}
                                    <CheckCircle2 class="size-4 shrink-0 text-emerald-500" />
                                    <span class="min-w-0 flex-1 text-sm">Completed</span>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        onclick={() => openTaskChat(task)}
                                        aria-label={`Open ${task.chatTitle || 'Untitled Chat'}`}
                                        title="Open chat"
                                    >
                                        <Search class="size-3.5" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        onclick={() => dismissTask(task)}
                                        aria-label={`Dismiss ${task.title}`}
                                        title="Dismiss"
                                    >
                                        <X class="size-3.5" />
                                    </Button>
                                {:else if task.kind === 'dictation' && task.phase === 'recording'}
                                    <Mic class="size-4 shrink-0 text-destructive" />
                                    <span class="min-w-0 flex-1 text-sm">Recording</span>
                                    <Button
                                        variant="secondary"
                                        size="icon-sm"
                                        onclick={() => finishDictation(task.chatId)}
                                        aria-label="Stop and transcribe"
                                        title="Stop and transcribe"
                                    >
                                        <Square class="size-3 fill-current" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        onclick={() => openTaskChat(task)}
                                        aria-label={`Open ${task.chatTitle || 'Untitled Chat'}`}
                                        title="Open chat"
                                    >
                                        <Search class="size-3.5" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        onclick={() => cancelTask(task)}
                                        aria-label="Cancel dictation"
                                        title="Cancel"
                                    >
                                        <X class="size-3.5" />
                                    </Button>
                                {:else}
                                    <Loader2 class="size-4 shrink-0 animate-spin text-primary" />
                                    <span class="min-w-0 flex-1 text-sm text-muted-foreground">
                                        {task.kind === 'dictation' ? 'Transcribing' : 'Running'}
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        onclick={() => openTaskChat(task)}
                                        aria-label={`Open ${task.chatTitle || 'Untitled Chat'}`}
                                        title="Open chat"
                                    >
                                        <Search class="size-3.5" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        onclick={() => cancelTask(task)}
                                        aria-label={`Cancel ${task.title}`}
                                        title="Cancel"
                                    >
                                        <X class="size-3.5" />
                                    </Button>
                                {/if}
                            </div>
                        </section>
                    {/each}
                </div>
            </aside>
        {/if}
    </div>
{/if}
