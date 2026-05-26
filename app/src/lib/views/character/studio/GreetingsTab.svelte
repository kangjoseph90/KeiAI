<script lang="ts">
    import { MessageSquare, Plus, Zap, Trash2, ChevronDown, ChevronRight } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Textarea } from '$lib/components/ui/textarea';
    import { generateSortOrder } from '$lib/utils/ordering';
    import SortableList from '$lib/components/entitylist/SortableList.svelte';
    import type { Character } from '$lib/services';
    import { SvelteSet } from 'svelte/reactivity';

    interface Props {
        character: Character;
        isChatSynced: boolean;
        onCreate: (fields: { content: string; sortOrder: string }) => void | Promise<void>;
        onUpdate: (
            id: string,
            changes: { content?: string; sortOrder?: string }
        ) => void | Promise<void>;
        onDelete: (id: string) => void | Promise<void>;
    }

    let { character, isChatSynced, onCreate, onUpdate, onDelete }: Props = $props();
    let newGreeting = $state('');
    let expanded = new SvelteSet<string>();

    function toggleExpand(id: string) {
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
    }

    function preview(content: string, max = 80): string {
        const oneLine = content.replace(/\n/g, ' ').trim();
        return oneLine.length > max ? oneLine.slice(0, max) + '...' : oneLine;
    }

    async function handleAdd() {
        if (!newGreeting.trim()) return;
        const sortOrder = generateSortOrder(
            Object.fromEntries(
                Object.values(character.greetings ?? {}).map((g) => [
                    g.id,
                    { id: g.id, sortOrder: g.sortOrder }
                ])
            )
        );
        await onCreate({ content: newGreeting, sortOrder });
        newGreeting = '';
    }

    async function handleReorder(id: string, newSortOrder: string) {
        await onUpdate(id, { sortOrder: newSortOrder });
    }
</script>

<section class="space-y-6">
    <div class="flex items-center justify-between">
        <div>
            <h2 class="text-lg font-semibold">Greetings</h2>
            <p class="text-sm text-muted-foreground">
                Initial messages that start a new conversation.
            </p>
        </div>
        <div class="flex gap-2">
            <Textarea
                placeholder="New greeting..."
                class="w-64 min-h-[40px] h-[40px] py-2 resize-none"
                bind:value={newGreeting}
                onkeydown={(e) =>
                    e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleAdd())}
            />
            <Button size="sm" class="gap-1.5 h-10" onclick={handleAdd}>
                <Plus class="size-4" /> Add
            </Button>
        </div>
    </div>

    {#if isChatSynced}
        <div class="bg-primary/10 border border-primary/20 rounded-lg p-4 flex items-start gap-3">
            <Zap class="size-5 text-primary shrink-0 mt-0.5" />
            <div class="text-sm">
                <p class="font-medium text-primary">Live Sync Active</p>
                <p class="text-muted-foreground">
                    This chat has not started yet. Editing greetings here will automatically update
                    the first message of your current chat.
                </p>
            </div>
        </div>
    {:else}
        <div class="bg-muted border rounded-lg p-4 flex items-start gap-3">
            <MessageSquare class="size-5 text-muted-foreground shrink-0 mt-0.5" />
            <div class="text-sm">
                <p class="font-medium">Conversation Started</p>
                <p class="text-muted-foreground">
                    Greeting changes won't affect the current chat transcript as it has already
                    progressed.
                </p>
            </div>
        </div>
    {/if}

    <SortableList entities={Object.values(character.greetings ?? {})} onReorder={handleReorder}>
        {#snippet empty()}
            <p class="py-6 text-center text-xs text-muted-foreground">No greetings.</p>
        {/snippet}
        {#snippet item({ entity: g })}
            <div class="flex flex-col rounded-lg border p-3">
                <div class="flex items-center gap-2">
                    <button
                        class="shrink-0 rounded hover:bg-muted p-0.5"
                        onclick={() => toggleExpand(g.id)}
                    >
                        {#if expanded.has(g.id)}
                            <ChevronDown class="size-3.5 text-muted-foreground" />
                        {:else}
                            <ChevronRight class="size-3.5 text-muted-foreground" />
                        {/if}
                    </button>
                    {#if !expanded.has(g.id)}
                        <span class="text-xs text-muted-foreground truncate"
                            >{preview(g.content)}</span
                        >
                    {:else}
                        <span class="text-xs font-medium">Greeting</span>
                    {/if}
                    <div class="flex-1"></div>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        class="text-destructive hover:text-destructive"
                        onclick={() => onDelete(g.id)}
                    >
                        <Trash2 class="size-3.5" />
                    </Button>
                </div>
                {#if expanded.has(g.id)}
                    <Textarea
                        rows={6}
                        value={g.content}
                        oninput={(e) => onUpdate(g.id, { content: e.currentTarget.value })}
                        class="text-xs mt-1.5"
                    />
                {/if}
            </div>
        {/snippet}
    </SortableList>
</section>
