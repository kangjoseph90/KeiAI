<script lang="ts">
    import { Plus, Trash2, ChevronDown, ChevronRight, GripVertical } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Textarea } from '$lib/components/ui/textarea';
    import ListActionBar from '$lib/components/ListActionBar.svelte';
    import { generateSortOrder } from '$lib/utils/ordering';
    import SortableList from '$lib/components/entitylist/SortableList.svelte';
    import type { Character } from '$lib/services';
    import { SvelteSet } from 'svelte/reactivity';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    interface Props {
        character: Character;
        onCreate: (fields: { content: string; sortOrder: string }) => string | Promise<string>;
        onUpdate: (
            id: string,
            changes: { content?: string; sortOrder?: string }
        ) => void | Promise<void>;
        onDelete: (id: string) => void | Promise<void>;
    }

    let { character, onCreate, onUpdate, onDelete }: Props = $props();
    let expanded = new SvelteSet<string>();
    let busyAction = $state<string | null>(null);

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
        if (busyAction) return;
        const characterId = character.id;
        const sortOrder = generateSortOrder(
            Object.fromEntries(
                Object.values(character.greetings ?? {}).map((g) => [
                    g.id,
                    { id: g.id, sortOrder: g.sortOrder }
                ])
            )
        );
        busyAction = 'create';
        try {
            const greetingId = await onCreate({ content: '', sortOrder });
            if (character.id === characterId) expanded.add(greetingId);
        } catch (error) {
            toast.error({ title: 'Could not add greeting', description: getErrorMessage(error) });
        } finally {
            busyAction = null;
        }
    }

    async function handleReorder(id: string, newSortOrder: string) {
        if (busyAction) return;
        busyAction = `reorder:${id}`;
        try {
            await onUpdate(id, { sortOrder: newSortOrder });
        } catch (error) {
            toast.error({
                title: 'Could not reorder greeting',
                description: getErrorMessage(error)
            });
        } finally {
            busyAction = null;
        }
    }

    async function handleUpdate(id: string, content: string) {
        if (busyAction) return;
        busyAction = `update:${id}`;
        try {
            await onUpdate(id, { content });
        } catch (error) {
            toast.error({
                title: 'Could not update greeting',
                description: getErrorMessage(error)
            });
        } finally {
            busyAction = null;
        }
    }

    async function handleDelete(id: string) {
        if (busyAction) return;
        const characterId = character.id;
        busyAction = `delete:${id}`;
        try {
            const confirmed = await appConfirm({
                title: 'Delete greeting?',
                description: 'This greeting will be permanently deleted.',
                confirmText: 'Delete',
                variant: 'destructive'
            });
            if (!confirmed || character.id !== characterId) return;
            await onDelete(id);
        } catch (error) {
            toast.error({
                title: 'Could not delete greeting',
                description: getErrorMessage(error)
            });
        } finally {
            busyAction = null;
        }
    }
</script>

<section class="space-y-6">
    <ListActionBar description="Opening messages for new conversations.">
        <Button
            size="sm"
            class="gap-1.5"
            disabled={busyAction !== null}
            aria-busy={busyAction === 'create'}
            onclick={handleAdd}
        >
            <Plus class="size-4" /> Add
        </Button>
    </ListActionBar>

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
                    <div
                        class="flex h-8 w-5 shrink-0 cursor-grab active:cursor-grabbing select-none items-center justify-center text-muted-foreground/45 transition-colors hover:text-muted-foreground"
                        aria-hidden="true"
                    >
                        <GripVertical class="size-4" />
                    </div>
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
                        disabled={busyAction !== null}
                        aria-busy={busyAction === `delete:${g.id}`}
                        onclick={() => handleDelete(g.id)}
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
                            disabled={busyAction !== null}
                            placeholder="Write greeting message..."
                            onchange={(e) => handleUpdate(g.id, e.currentTarget.value)}
                            class="text-xs bg-background leading-relaxed"
                        />
                    </div>
                {/if}
            </div>
        {/snippet}
    </SortableList>
</section>
