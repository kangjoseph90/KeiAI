<script lang="ts" generics="T extends { id: string; sortOrder?: string }">
    import { type Snippet } from 'svelte';
    import { flip } from 'svelte/animate';
    import { compareSortOrder } from '$lib/utils/ordering';
    import { generateKeyBetween } from 'fractional-indexing';
    import { isInteractiveDragTarget, pointerDrag } from './pointer-drag';
    import { toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';
    import { t } from '$lib/stores';

    interface Props {
        entities: T[];
        onReorder: (id: string, newSortOrder: string) => Promise<void>;
        onItemClick?: (entity: T) => void | Promise<void>;
        item: Snippet<[{ entity: T }]>;
        empty?: Snippet;
        listClass?: string;
    }

    let {
        entities,
        onReorder,
        onItemClick = undefined,
        item: itemSnippet,
        empty: emptySnippet = undefined,
        listClass = 'flex flex-col gap-1 w-full'
    }: Props = $props();

    // ─── Drag State ────────────────────────────────────────────────────
    let draggedId: string | null = $state(null);
    let dragOverId: string | null = $state(null);
    let dragOverZone: 'before' | 'after' | null = $state(null);
    let dropPending = $state(false);

    // ─── Sorted Items ──────────────────────────────────────────────────
    const sortedItems = $derived.by(() => {
        const withOrder: { entity: T; sortOrder: string | null }[] = [];
        const withoutOrder: { entity: T; sortOrder: string | null }[] = [];

        for (const ent of entities) {
            if (!ent) continue;
            if (ent.sortOrder) {
                withOrder.push({ entity: ent, sortOrder: ent.sortOrder });
            } else {
                withoutOrder.push({ entity: ent, sortOrder: null });
            }
        }

        withOrder.sort((a, b) => compareSortOrder(a.sortOrder, b.sortOrder));
        return [...withOrder, ...withoutOrder];
    });

    // ─── Drag Handlers ─────────────────────────────────────────────────
    function resetDragState() {
        draggedId = null;
        dragOverId = null;
        dragOverZone = null;
    }

    function setDragTarget(
        target: HTMLElement,
        clientY: number,
        item: { entity: T; sortOrder: string | null }
    ) {
        if (draggedId === item.entity.id) {
            dragOverId = null;
            dragOverZone = null;
            return;
        }

        const rect = target.getBoundingClientRect();
        const pctY = (clientY - rect.top) / rect.height;

        dragOverId = item.entity.id;
        dragOverZone = pctY < 0.5 ? 'before' : 'after';
    }

    async function dropOnTarget(target: { entity: T; sortOrder: string | null }) {
        const id = draggedId;
        const zone = dragOverZone;
        resetDragState();

        if (!id || !zone || id === target.entity.id) return;

        const siblings = sortedItems;
        const targetIdx = siblings.findIndex((s) => s.entity.id === target.entity.id);
        if (targetIdx === -1) return;

        const targetOrder = target.sortOrder;
        if (!targetOrder) return;

        let newSortOrder: string;
        if (zone === 'before') {
            const prev = siblings[targetIdx - 1];
            newSortOrder = prev?.sortOrder
                ? generateKeyBetween(prev.sortOrder, targetOrder)
                : generateKeyBetween(null, targetOrder);
        } else {
            const next = siblings[targetIdx + 1];
            newSortOrder = next?.sortOrder
                ? generateKeyBetween(targetOrder, next.sortOrder)
                : generateKeyBetween(targetOrder, null);
        }

        await onReorder(id, newSortOrder);
    }

    function findPointerTarget(clientX: number, clientY: number) {
        const element = document
            .elementFromPoint(clientX, clientY)
            ?.closest<HTMLElement>('[data-sortable-dnd-id]');
        if (!element) return null;
        const item = sortedItems.find(
            (candidate) => candidate.entity.id === element.dataset.sortableDndId
        );
        return item ? { element, item } : null;
    }

    function handlePointerDragMove(clientX: number, clientY: number) {
        const target = findPointerTarget(clientX, clientY);
        if (!target) {
            dragOverId = null;
            dragOverZone = null;
            return null;
        }
        setDragTarget(target.element, clientY, target.item);
        return target;
    }

    async function handlePointerDrop(clientX: number, clientY: number) {
        if (dropPending) return;
        const target = handlePointerDragMove(clientX, clientY);
        if (!target) {
            resetDragState();
            return;
        }
        dropPending = true;
        try {
            await dropOnTarget(target.item);
        } catch (error) {
            toast.error({
                title: $t('components.sortableList.reorderFailed'),
                description: getErrorMessage(error)
            });
        } finally {
            dropPending = false;
        }
    }
</script>

<div class="relative {listClass} {draggedId ? 'drag-active' : ''}" aria-busy={dropPending}>
    {#each sortedItems as item (item.entity.id)}
        {@const entity = item.entity}
        <div
            animate:flip={{ duration: 150 }}
            data-sortable-dnd-id={entity.id}
            use:pointerDrag={{
                disabled: dropPending,
                onStart: () => {
                    draggedId = entity.id;
                },
                onMove: handlePointerDragMove,
                onDrop: handlePointerDrop,
                onCancel: resetDragState
            }}
            onclick={(e) => {
                if (!isInteractiveDragTarget(e.target) && onItemClick) {
                    onItemClick(entity);
                }
            }}
            role="none"
            class="relative w-full select-none drop-target"
        >
            {@render itemSnippet({ entity })}

            {#if dragOverId === entity.id}
                {#if dragOverZone === 'before'}
                    <div
                        class="absolute top-0 left-0 right-0 h-0.5 bg-primary/60 z-50 pointer-events-none rounded-full"
                    ></div>
                {:else if dragOverZone === 'after'}
                    <div
                        class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/60 z-50 pointer-events-none rounded-full"
                    ></div>
                {/if}
            {/if}
        </div>
    {/each}
    {#if sortedItems.length === 0 && emptySnippet}
        {@render emptySnippet()}
    {/if}
</div>

<style>
    :global(.drag-active) .drop-target > * {
        pointer-events: none !important;
    }
    :global(.pointer-drag-source) {
        opacity: 0.4;
    }
</style>
