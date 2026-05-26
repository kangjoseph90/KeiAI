<script lang="ts" generics="T extends { id: string; sortOrder?: string }">
    import { type Snippet } from 'svelte';
    import { compareSortOrder } from '$lib/utils/ordering';
    import { generateKeyBetween } from 'fractional-indexing';

    interface Props {
        entities: T[];
        onReorder: (id: string, newSortOrder: string) => Promise<void>;
        item: Snippet<[{ entity: T }]>;
        empty?: Snippet;
    }

    let {
        entities,
        onReorder,
        item: itemSnippet,
        empty: emptySnippet = undefined
    }: Props = $props();

    // ─── Drag State ────────────────────────────────────────────────────
    let draggedId: string | null = $state(null);
    let dragOverId: string | null = $state(null);
    let dragOverZone: 'before' | 'after' | null = $state(null);
    let dragSuppressedId: string | null = $state(null);

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
    function isInteractiveDragTarget(target: EventTarget | null): boolean {
        if (!(target instanceof HTMLElement)) return false;
        return Boolean(
            target.closest(
                'input, textarea, select, button, a, [contenteditable="true"], [data-no-reorder-drag]'
            )
        );
    }

    function handlePointerDown(e: PointerEvent, id: string) {
        dragSuppressedId = isInteractiveDragTarget(e.target) ? id : null;
    }

    function clearDragSuppression() {
        dragSuppressedId = null;
    }

    function handleDragStart(e: DragEvent, id: string) {
        if (dragSuppressedId === id || isInteractiveDragTarget(e.target)) {
            e.preventDefault();
            return;
        }

        draggedId = id;
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', id);
        }
    }

    function resetDragState() {
        draggedId = null;
        dragOverId = null;
        dragOverZone = null;
        dragSuppressedId = null;
    }

    function handleDragOver(e: DragEvent, item: { entity: T; sortOrder: string | null }) {
        e.stopPropagation();
        if (draggedId === item.entity.id) return;
        e.preventDefault();

        const target = e.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        const pctY = (e.clientY - rect.top) / rect.height;

        dragOverId = item.entity.id;
        dragOverZone = pctY < 0.5 ? 'before' : 'after';
    }

    function handleDragLeave(e: DragEvent, id: string) {
        e.stopPropagation();
        if (dragOverId === id) {
            dragOverId = null;
            dragOverZone = null;
        }
    }

    async function handleDrop(e: DragEvent, target: { entity: T; sortOrder: string | null }) {
        e.preventDefault();
        e.stopPropagation();

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
</script>

<div class="relative flex flex-col w-full {draggedId ? 'drag-active' : ''}">
    {#each sortedItems as item (item.entity.id)}
        {@const entity = item.entity}
        <div
            draggable={dragSuppressedId !== entity.id}
            onpointerdown={(e) => handlePointerDown(e, entity.id)}
            onpointerup={clearDragSuppression}
            onpointercancel={clearDragSuppression}
            ondragstart={(e) => handleDragStart(e, entity.id)}
            ondragover={(e) => handleDragOver(e, item)}
            ondragleave={(e) => handleDragLeave(e, entity.id)}
            ondrop={(e) => handleDrop(e, item)}
            ondragend={resetDragState}
            role="none"
            class="relative transition-all duration-200 drop-target w-full py-0.5"
        >
            {@render itemSnippet({ entity })}

            {#if dragOverId === entity.id}
                {#if dragOverZone === 'before'}
                    <div
                        class="absolute top-0 left-0 right-0 h-[3px] bg-primary z-50 pointer-events-none rounded-full"
                    ></div>
                {:else if dragOverZone === 'after'}
                    <div
                        class="absolute bottom-0 left-0 right-0 h-[3px] bg-primary z-50 pointer-events-none rounded-full"
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
    .drop-target {
        position: relative;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    :global(.drag-active) .drop-target > * {
        pointer-events: none !important;
    }
</style>
