<script lang="ts">
    import { Plus, Zap, Trash2, ChevronDown, ChevronRight } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Textarea } from '$lib/components/ui/textarea';
    import ListActionBar from '$lib/components/ListActionBar.svelte';
    import { generateSortOrder } from '$lib/utils/ordering';
    import SortableList from '$lib/components/entitylist/SortableList.svelte';
    import type { Character } from '$lib/services';
    import { SvelteSet } from 'svelte/reactivity';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';

    interface Props {
        character: Character;
        isChatSynced: boolean;
        onCreate: (fields: { content: string; sortOrder: string }) => string | Promise<string>;
        onUpdate: (
            id: string,
            changes: { content?: string; sortOrder?: string }
        ) => void | Promise<void>;
        onDelete: (id: string) => void | Promise<void>;
    }

    let { character, isChatSynced, onCreate, onUpdate, onDelete }: Props = $props();
    let expanded = new SvelteSet<string>();

    function toggleExpand(id: string) {
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
    }

    function preview(content: string, max = 80): string {
        const oneLine = content.replace(/\n/g, ' ').trim();
        return oneLine.length > max
            ? oneLine.slice(0, max) + '...'
            : oneLine || 'Empty greeting message';
    }

    async function handleAdd() {
        const sortOrder = generateSortOrder(
            Object.fromEntries(
                Object.values(character.greetings ?? {}).map((g) => [
                    g.id,
                    { id: g.id, sortOrder: g.sortOrder }
                ])
            )
        );
        const greetingId = await onCreate({ content: '', sortOrder });
        expanded.add(greetingId);
    }

    async function handleReorder(id: string, newSortOrder: string) {
        await onUpdate(id, { sortOrder: newSortOrder });
    }
</script>

<section class="space-y-6">
    <ListActionBar description="Opening messages for new conversations.">
        <Button size="sm" class="gap-1.5" onclick={handleAdd}>
            <Plus class="size-4" /> Add
        </Button>
    </ListActionBar>

    {#if isChatSynced}
        <div class="bg-primary/10 border border-primary/20 rounded-lg p-4 flex items-start gap-3">
            <Zap class="size-5 text-primary shrink-0 mt-0.5" />
            <div class="text-sm">
                <p class="font-medium text-primary">Live Sync Active</p>
                <p class="text-muted-foreground text-xs mt-0.5">
                    This chat has not started yet. Editing greetings here will automatically update
                    the first message of your current chat.
                </p>
            </div>
        </div>
    {/if}

    <SortableList entities={Object.values(character.greetings ?? {})} onReorder={handleReorder}>
        {#snippet empty()}
            <EmptyListPlaceholder message="No greetings." />
        {/snippet}
        {#snippet item({ entity: g })}
            <div
                class="group overflow-hidden rounded-xl border bg-card shadow-sm transition-[border-color,box-shadow,opacity] hover:border-border/80 hover:shadow-md"
            >
                <!-- 헤더 영역 -->
                <div class="flex min-h-14 items-center gap-2 px-3 py-2">
                    <button
                        type="button"
                        class="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        onclick={() => toggleExpand(g.id)}
                        aria-label={expanded.has(g.id) ? 'Collapse' : 'Expand'}
                    >
                        {#if expanded.has(g.id)}
                            <ChevronDown class="size-4" />
                        {:else}
                            <ChevronRight class="size-4" />
                        {/if}
                    </button>

                    {#if !expanded.has(g.id)}
                        <span
                            class="text-xs text-muted-foreground truncate flex-1 select-none pl-1"
                        >
                            {preview(g.content)}
                        </span>
                    {:else}
                        <span class="text-xs font-medium text-foreground flex-1 select-none pl-1">
                            Greeting Message
                        </span>
                    {/if}

                    <Button
                        size="icon"
                        variant="ghost"
                        class="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onclick={() => onDelete(g.id)}
                        aria-label="Delete greeting"
                    >
                        <Trash2 class="size-4" />
                    </Button>
                </div>

                <!-- 펼쳐지는 바디 영역 -->
                {#if expanded.has(g.id)}
                    <div class="flex flex-col gap-4 border-t bg-muted/20 p-4">
                        <Textarea
                            rows={6}
                            value={g.content}
                            placeholder="Write greeting message..."
                            onchange={(e) => onUpdate(g.id, { content: e.currentTarget.value })}
                            class="text-xs bg-background leading-relaxed"
                        />
                    </div>
                {/if}
            </div>
        {/snippet}
    </SortableList>
</section>
