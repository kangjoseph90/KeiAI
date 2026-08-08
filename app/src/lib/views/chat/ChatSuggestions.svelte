<script lang="ts">
    import { Check, Loader2, Plus, X } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import AutoResizeTextarea from '$lib/components/AutoResizeTextarea.svelte';
    import {
        appendChatDraftText,
        chatDrafts,
        dismissChatDraftSuggestion,
        inputTranslationTasks,
        setChatDraftText
    } from '$lib/stores';
    import { dismissInputTranslation, stopInputTranslation } from '$lib/tasks';
    import TaskErrorNotice from './TaskErrorNotice.svelte';

    let { chatId, class: className }: { chatId: string; class?: string } = $props();

    const suggestions = $derived(Object.entries($chatDrafts.get(chatId)?.suggestions ?? {}));
    const draftText = $derived($chatDrafts.get(chatId)?.text ?? '');

    function dismiss(chatId: string, suggestionId: string): void {
        dismissChatDraftSuggestion(chatId, suggestionId);
        dismissInputTranslation(suggestionId);
    }

    function applyToDraft(
        chatId: string,
        suggestionId: string,
        action: () => void | Promise<void>
    ): void {
        void Promise.resolve(action()).then(() => {
            dismissChatDraftSuggestion(chatId, suggestionId);
            dismissInputTranslation(suggestionId);
        });
    }
</script>

<div class="flex flex-col gap-2 {className}">
    {#each suggestions as [suggestionId, text] (suggestionId)}
        {@const inputTranslationTask = $inputTranslationTasks.get(suggestionId)}
        {@const generating = inputTranslationTask?.status === 'generating'}
        {@const errored = inputTranslationTask?.status === 'error'}
        {#if errored}
            <TaskErrorNotice
                title="Input translation failed"
                message={inputTranslationTask?.errorMessage ?? ''}
                onDismiss={() => {
                    if (!text.trim()) {
                        dismissChatDraftSuggestion(chatId, suggestionId);
                    }
                    dismissInputTranslation(suggestionId);
                }}
            />
        {:else}
            <div
                class="flex items-end gap-1 rounded-2xl border border-border/80 bg-background/90 py-2 px-3 text-sm shadow-sm backdrop-blur-xl"
            >
                <div class="flex min-w-0 flex-1 items-center self-stretch">
                    {#if generating && !text}
                        <span class="py-0.5 text-foreground/70">Translating…</span>
                    {:else}
                        <AutoResizeTextarea
                            value={text}
                            maxHeight={180}
                            classname="min-h-6 max-h-45 w-full resize-none border-0 bg-transparent px-0 py-0.5 text-sm text-foreground/70 shadow-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-default disabled:opacity-100"
                            disabled
                        />
                    {/if}
                </div>
                {#if generating}
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        class="shrink-0 self-end rounded-full text-muted-foreground"
                        title="Stop"
                        aria-label="Stop"
                        onclick={() => stopInputTranslation(suggestionId)}
                    >
                        <Loader2 class="size-4 animate-spin" />
                    </Button>
                {:else}
                    <div class="flex shrink-0 items-center gap-1 self-end">
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            class="rounded-full text-muted-foreground"
                            title="Apply to draft"
                            aria-label="Apply to draft"
                            onclick={() =>
                                applyToDraft(chatId, suggestionId, () =>
                                    setChatDraftText(chatId, text)
                                )}
                        >
                            <Check class="size-4" />
                        </Button>
                        {#if draftText.trim().length > 0}
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                class="rounded-full text-muted-foreground"
                                title="Add to draft"
                                aria-label="Add to draft"
                                onclick={() =>
                                    applyToDraft(chatId, suggestionId, () =>
                                        appendChatDraftText(chatId, text)
                                    )}
                            >
                                <Plus class="size-4" />
                            </Button>
                        {/if}
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            class="rounded-full text-muted-foreground"
                            title="Dismiss"
                            aria-label="Dismiss"
                            onclick={() => dismiss(chatId, suggestionId)}
                        >
                            <X class="size-4" />
                        </Button>
                    </div>
                {/if}
            </div>
        {/if}
    {/each}
</div>
