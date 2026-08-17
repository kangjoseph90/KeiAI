<script lang="ts">
    import { Plus, Trash2, ChevronDown, ChevronRight, GripVertical } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import SyntaxTextarea from '$lib/components/SyntaxTextarea.svelte';
    import ListActionBar from '$lib/components/ListActionBar.svelte';
    import { generateSortOrder } from '$lib/utils/ordering';
    import { generateId } from '$lib/utils/id';
    import SortableList from '$lib/components/entitylist/SortableList.svelte';
    import EditableListItem from '$lib/components/entitylist/EditableListItem.svelte';
    import type { Character, Greeting } from '$lib/services';
    import { SvelteSet } from 'svelte/reactivity';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';
    import { t } from '$lib/stores';

    interface Props {
        character: Character;
        onSave: (item: Greeting) => string | void | Promise<string | void>;
        onDelete: (id: string) => void | Promise<void>;
    }

    let { character, onSave, onDelete }: Props = $props();
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
            : oneLine || $t('character.greetings.emptyMessage');
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
        const greeting: Greeting = { id: generateId(), content: '', sortOrder };
        busyAction = 'create';
        try {
            await onSave(greeting);
            if (character.id === characterId) expanded.add(greeting.id);
        } catch (error) {
            toast.error({
                title: $t('character.toast.addGreeting'),
                description: getErrorMessage(error)
            });
        } finally {
            busyAction = null;
        }
    }

    async function handleReorder(id: string, newSortOrder: string) {
        if (busyAction) return;
        const greeting = character.greetings[id];
        if (!greeting) return;
        busyAction = `reorder:${id}`;
        try {
            await onSave({ ...greeting, sortOrder: newSortOrder, id });
        } catch (error) {
            toast.error({
                title: $t('character.toast.reorderGreeting'),
                description: getErrorMessage(error)
            });
        } finally {
            busyAction = null;
        }
    }

    async function handleUpdate(id: string, content: string) {
        if (busyAction) return;
        const greeting = character.greetings[id];
        if (!greeting) return;
        busyAction = `update:${id}`;
        try {
            await onSave({ ...greeting, content, id });
        } catch (error) {
            toast.error({
                title: $t('character.toast.updateGreeting'),
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
                title: $t('character.greetings.deleteTitle'),
                description: $t('character.greetings.deleteBody'),
                confirmText: $t('common.actions.delete'),
                variant: 'destructive'
            });
            if (!confirmed || character.id !== characterId) return;
            await onDelete(id);
        } catch (error) {
            toast.error({
                title: $t('character.toast.deleteGreeting'),
                description: getErrorMessage(error)
            });
        } finally {
            busyAction = null;
        }
    }
</script>

<section class="space-y-4">
    <ListActionBar description={$t('character.greetings.description')}>
        <Button
            size="sm"
            class="gap-1.5"
            disabled={busyAction !== null}
            aria-busy={busyAction === 'create'}
            onclick={handleAdd}
        >
            <Plus class="size-4" />
            {$t('character.greetings.addButton')}
        </Button>
    </ListActionBar>

    <SortableList entities={Object.values(character.greetings ?? {})} onReorder={handleReorder}>
        {#snippet empty()}
            <EmptyListPlaceholder message={$t('character.greetings.empty')} />
        {/snippet}
        {#snippet item({ entity: g })}
            <EditableListItem expanded={expanded.has(g.id)} busy={busyAction === `delete:${g.id}`}>
                {#snippet header()}
                    <!-- 헤더 영역 -->
                    <div
                        class="flex h-7 w-4 shrink-0 cursor-grab active:cursor-grabbing select-none items-center justify-center text-muted-foreground/45 transition-colors hover:text-muted-foreground"
                        aria-hidden="true"
                    >
                        <GripVertical class="size-3.5" />
                    </div>
                    <button
                        type="button"
                        class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        onclick={() => toggleExpand(g.id)}
                        aria-label={expanded.has(g.id)
                            ? $t('common.actions.collapse')
                            : $t('common.actions.expand')}
                    >
                        {#if expanded.has(g.id)}
                            <ChevronDown class="size-3.5" />
                        {:else}
                            <ChevronRight class="size-3.5" />
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
                            {$t('character.greetings.title')}
                        </span>
                    {/if}

                    <Button
                        size="icon-sm"
                        variant="ghost"
                        class="shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={busyAction !== null}
                        aria-busy={busyAction === `delete:${g.id}`}
                        onclick={() => handleDelete(g.id)}
                        aria-label={$t('character.greetings.delete')}
                    >
                        <Trash2 class="size-3.5" />
                    </Button>
                {/snippet}

                <!-- 펼쳐지는 바디 영역 -->
                {#snippet details()}
                    <SyntaxTextarea
                        id={`greeting-${g.id}-content`}
                        ariaLabel={$t('character.greetings.placeholder')}
                        minRows={6}
                        language="markdown"
                        template
                        value={g.content}
                        disabled={busyAction !== null}
                        placeholder={$t('character.greetings.placeholder')}
                        onchange={(e) => handleUpdate(g.id, e.currentTarget.value)}
                        class="text-xs bg-background leading-relaxed"
                    />
                {/snippet}
            </EditableListItem>
        {/snippet}
    </SortableList>
</section>
