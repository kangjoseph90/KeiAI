<script lang="ts" generics="T extends { id: string }">
    import { getContext, setContext, type Snippet } from 'svelte';
    import {
        COLOR_CLASSES,
        COLOR_BG_CLASSES,
        COLOR_PRESETS,
        getFolderColorClass,
        getFolderGroupClass
    } from './folders';
    import { Folder, FolderOpen, MoreVertical, Edit2, Trash2, Palette } from 'lucide-svelte';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import type { FolderDef, EntityListConfig } from '$lib/types/refs';
    import { compareSortOrder, generateSortOrder } from '$lib/utils/ordering';
    import { generateKeyBetween } from 'fractional-indexing';
    import EntityList from './EntityList.svelte';

    interface FolderSnippetPayload {
        folder: FolderDef;
        collapsed: boolean;
        toggle: () => void;
        childCount: number;
        parts: {
            icon: Snippet<[{ folder: FolderDef; collapsed: boolean; sizeClass?: string }]>;
            name: Snippet<[{ folder: FolderDef }]>;
            actions: Snippet<[{ folder: FolderDef }]>;
        };
    }

    interface Props {
        entities: T[];
        config: EntityListConfig;
        layout?: 'grid' | 'list';
        parentId?: string;

        // Custom styling props for wrapper slots
        gridClass?: string;
        listClass?: string;
        childContainerClass?: string;
        folderWrapperClass?: (folder: FolderDef, isCollapsed: boolean) => string;
        itemWrapperClass?: (entity: T) => string;

        onCreateFolder: (name: string, parentId?: string, sortOrder?: string) => Promise<FolderDef>;
        onUpdateFolder: (
            folderId: string,
            changes: Partial<{ name: string; color: string; parentId: string; sortOrder: string }>
        ) => Promise<void>;
        onDeleteFolder: (folderId: string) => Promise<void>;
        onMoveItem: (itemId: string, newFolderId?: string, newSortOrder?: string) => Promise<void>;

        item: Snippet<[{ entity: T }]>;
        folder?: Snippet<[FolderSnippetPayload]>;
        empty?: Snippet;
    }

    let {
        entities,
        config,
        layout = 'list',
        parentId = undefined,
        gridClass = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 w-full',
        listClass = 'flex flex-col w-full',
        childContainerClass = 'relative ml-4 my-1 pl-3 pr-2 py-2',
        folderWrapperClass = undefined,
        itemWrapperClass = undefined,
        onCreateFolder,
        onUpdateFolder,
        onDeleteFolder,
        onMoveItem,
        item: itemSnippet,
        folder: folderSnippet = undefined,
        empty: emptySnippet = undefined
    }: Props = $props();

    // ─── Shared Drag & Drop State via Context ────────────────────────────
    interface SharedDragState {
        draggedId: string | null;
        draggedType: 'folder' | 'entity' | null;
        draggedParentId: string | undefined;
        dragOverId: string | null;
        dragOverZone: 'before' | 'after' | 'overlap' | null;
        collapsedFolders: Record<string, boolean>;
    }

    const CONTEXT_KEY = 'FolderListContextKey';

    const rootState = $state<SharedDragState>({
        draggedId: null,
        draggedType: null,
        draggedParentId: undefined,
        dragOverId: null,
        dragOverZone: null,
        collapsedFolders: {}
    });

    const parentCtx = getContext<SharedDragState>(CONTEXT_KEY);
    if (!parentCtx) setContext(CONTEXT_KEY, rootState);
    const ctx = parentCtx ?? rootState;

    // Local states
    let editingFolderId = $state<string | null>(null);
    let renameValue = $state('');
    let dragSuppressedId = $state<string | null>(null);

    interface VisualItem {
        type: 'folder' | 'entity';
        id: string;
        sortOrder: string | null;
        folder?: FolderDef;
        entity?: T;
        childCount?: number;
    }

    // ─── Visual Items Calculation ──────────────────────────────────────
    const visualItems = $derived.by(() => {
        const currentFolders = Object.values(config.folders || {}).filter(
            (f) => f && f.parentId === parentId
        );

        const currentEntities: T[] = [];
        const unreferredEntities: T[] = [];

        for (const ent of entities) {
            if (!ent) continue;
            const ref = config.refs?.[ent.id];
            if (!ref) {
                if (parentId === undefined) {
                    unreferredEntities.push(ent);
                }
            } else if (ref.folderId === parentId) {
                currentEntities.push(ent);
            }
        }

        const items: VisualItem[] = [];

        for (const f of currentFolders) {
            const childEntityCount = Object.values(config.refs || {}).filter(
                (r) => r?.folderId === f.id
            ).length;
            const childFolderCount = Object.values(config.folders || {}).filter(
                (sub) => sub?.parentId === f.id
            ).length;
            items.push({
                type: 'folder',
                id: f.id,
                sortOrder: f.sortOrder || null,
                folder: f,
                childCount: childEntityCount + childFolderCount
            });
        }

        for (const ent of currentEntities) {
            const ref = config.refs[ent.id];
            items.push({
                type: 'entity',
                id: ent.id,
                sortOrder: ref?.sortOrder || null,
                entity: ent
            });
        }

        items.sort((a, b) => compareSortOrder(a.sortOrder, b.sortOrder));

        for (const ent of unreferredEntities) {
            items.push({
                type: 'entity',
                id: ent.id,
                sortOrder: null,
                entity: ent
            });
        }

        return items;
    });

    // ─── Helper: Check Cyclical Folder Hierarchy ───────────────────────
    function isDescendantOf(folderId: string | undefined, ancestorId: string): boolean {
        let currentId = folderId;
        while (currentId) {
            if (currentId === ancestorId) return true;
            currentId = config.folders[currentId]?.parentId;
        }
        return false;
    }

    function isDragAllowed(
        draggedId: string | null,
        draggedType: 'folder' | 'entity' | null,
        targetNode: VisualItem
    ): boolean {
        if (!draggedId) return false;
        if (draggedId === targetNode.id) return false;

        if (draggedType === 'folder') {
            if (targetNode.type === 'folder') {
                return !isDescendantOf(targetNode.id, draggedId);
            } else {
                const targetFolderId = config.refs[targetNode.id]?.folderId;
                return !isDescendantOf(targetFolderId, draggedId);
            }
        }
        return true;
    }

    // ─── Drag & Drop Handlers ──────────────────────────────────────────
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

    function handleDragStart(e: DragEvent, node: VisualItem) {
        if (dragSuppressedId === node.id || isInteractiveDragTarget(e.target)) {
            e.preventDefault();
            return;
        }

        ctx.draggedId = node.id;
        ctx.draggedType = node.type;
        ctx.draggedParentId = parentId;

        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', node.id);
        }
    }

    function resetDragState() {
        ctx.draggedId = null;
        ctx.draggedType = null;
        ctx.draggedParentId = undefined;
        ctx.dragOverId = null;
        ctx.dragOverZone = null;
        dragSuppressedId = null;
    }

    function getSiblingsIn(folderId: string | undefined): {
        refs: Record<string, { sortOrder: string }>;
        folders: Record<string, { sortOrder: string }>;
    } {
        const refs = Object.fromEntries(
            Object.entries(config.refs).filter(([, r]) => r?.folderId === folderId)
        );
        const folders = Object.fromEntries(
            Object.entries(config.folders).filter(([, f]) => f?.parentId === folderId)
        );
        return { refs, folders };
    }

    function handleDragOver(e: DragEvent, node: VisualItem) {
        e.stopPropagation();

        if (!isDragAllowed(ctx.draggedId, ctx.draggedType, node)) {
            ctx.dragOverId = null;
            ctx.dragOverZone = null;
            return;
        }

        e.preventDefault();

        const target = e.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        let zone: 'before' | 'after' | 'overlap' = 'overlap';

        const isFolderOpen = node.type === 'folder' && !ctx.collapsedFolders[node.id];

        if (layout === 'list') {
            const pctY = (e.clientY - rect.top) / rect.height;
            if (pctY < 0.25) {
                zone = 'before';
            } else if (pctY > 0.75) {
                zone = isFolderOpen ? 'overlap' : 'after';
            }
        } else {
            const pctX = (e.clientX - rect.left) / rect.width;
            const pctY = (e.clientY - rect.top) / rect.height;
            if (pctX < 0.25 || pctY < 0.25) {
                zone = 'before';
            } else if (pctX > 0.75 || pctY > 0.75) {
                zone = isFolderOpen ? 'overlap' : 'after';
            }
        }

        ctx.dragOverId = node.id;
        ctx.dragOverZone = zone;
    }

    function handleDragLeave(e: DragEvent, node: VisualItem) {
        e.stopPropagation();
        if (ctx.dragOverId === node.id) {
            ctx.dragOverId = null;
            ctx.dragOverZone = null;
        }
    }

    async function handleDrop(e: DragEvent, targetNode: VisualItem) {
        e.preventDefault();
        e.stopPropagation();

        const draggedId = ctx.draggedId;
        const draggedType = ctx.draggedType;
        const sourceParentId = ctx.draggedParentId;
        const zone = ctx.dragOverZone;

        resetDragState();

        if (!draggedId || !draggedType || !zone) return;
        if (!isDragAllowed(draggedId, draggedType, targetNode)) return;

        if (zone === 'overlap') {
            if (targetNode.type === 'folder') {
                const siblings = getSiblingsIn(targetNode.id);
                const appendOrder = generateSortOrder(siblings.refs, siblings.folders);
                if (draggedType === 'entity') {
                    await onMoveItem(draggedId, targetNode.id, appendOrder);
                } else {
                    await onUpdateFolder(draggedId, {
                        parentId: targetNode.id,
                        sortOrder: appendOrder
                    });
                }
            } else {
                const newFolderName = prompt('Enter a name for the new folder:', 'Grouped Folder');
                if (!newFolderName) return;
                if (!targetNode.sortOrder) return;

                const newFolder = await onCreateFolder(
                    newFolderName,
                    parentId,
                    targetNode.sortOrder
                );
                try {
                    const firstKey = generateKeyBetween(null, null);
                    await onMoveItem(targetNode.id, newFolder.id, firstKey);

                    const secondKey = generateKeyBetween(firstKey, null);
                    if (draggedType === 'entity') {
                        await onMoveItem(draggedId, newFolder.id, secondKey);
                    } else {
                        await onUpdateFolder(draggedId, {
                            parentId: newFolder.id,
                            sortOrder: secondKey
                        });
                    }
                } catch {
                    await onDeleteFolder(newFolder.id);
                }
            }
        } else {
            const siblings = visualItems;
            const targetIdx = siblings.findIndex((s) => s.id === targetNode.id);
            if (targetIdx === -1) return;

            let newSortOrder: string;
            if (zone === 'before') {
                const prevNode = siblings[targetIdx - 1];
                newSortOrder = prevNode
                    ? generateKeyBetween(prevNode.sortOrder, targetNode.sortOrder)
                    : generateKeyBetween(null, targetNode.sortOrder);
            } else {
                const nextNode = siblings[targetIdx + 1];
                newSortOrder = nextNode
                    ? generateKeyBetween(targetNode.sortOrder, nextNode.sortOrder)
                    : generateKeyBetween(targetNode.sortOrder, null);
            }

            if (draggedType === 'entity') {
                await onMoveItem(draggedId, parentId, newSortOrder);
            } else {
                await onUpdateFolder(draggedId, { parentId, sortOrder: newSortOrder });
            }
        }

        if (sourceParentId) {
            await cleanEmptyFolders(sourceParentId);
        }
    }

    // ─── Nested Drop Zone Handlers ───────────────────────────────────────
    function handleNestedDragOver(e: DragEvent, folderId: string) {
        e.stopPropagation();
        if (ctx.draggedId && isDescendantOf(folderId, ctx.draggedId)) {
            ctx.dragOverId = null;
            ctx.dragOverZone = null;
            return;
        }
        e.preventDefault();
        ctx.dragOverId = folderId;
        ctx.dragOverZone = 'after';
    }

    function handleNestedDragLeave(e: DragEvent, folderId: string) {
        e.stopPropagation();
        if (ctx.dragOverId === folderId) {
            ctx.dragOverId = null;
            ctx.dragOverZone = null;
        }
    }

    async function handleNestedDrop(e: DragEvent, folderId: string) {
        e.preventDefault();
        e.stopPropagation();

        const draggedId = ctx.draggedId;
        const draggedType = ctx.draggedType;
        const sourceParentId = ctx.draggedParentId;

        resetDragState();

        if (!draggedId || !draggedType) return;
        if (isDescendantOf(folderId, draggedId)) return;

        const siblings = visualItems;
        const targetIdx = siblings.findIndex((s) => s.id === folderId);
        if (targetIdx === -1) return;

        let newSortOrder: string;
        const folder = siblings[targetIdx];
        const nextNode = siblings[targetIdx + 1];
        newSortOrder = nextNode
            ? generateKeyBetween(folder.sortOrder, nextNode.sortOrder)
            : generateKeyBetween(folder.sortOrder, null);

        if (draggedType === 'entity') {
            await onMoveItem(draggedId, parentId, newSortOrder);
        } else {
            await onUpdateFolder(draggedId, { parentId, sortOrder: newSortOrder });
        }

        if (sourceParentId) {
            await cleanEmptyFolders(sourceParentId);
        }
    }

    // ─── Folder Children Lookup ──────────────────────────────────────────
    function getChildrenOf(folderId: string) {
        const childRefs = Object.values(config.refs || {}).filter((r) => r?.folderId === folderId);
        const childFolders = Object.values(config.folders || {}).filter(
            (f) => f?.parentId === folderId
        );
        return { childRefs, childFolders };
    }

    // ─── Folder Clean-up ───────────────────────────────────────────────
    async function cleanEmptyFolders(folderId: string) {
        const { childRefs, childFolders } = getChildrenOf(folderId);

        if (childRefs.length === 0 && childFolders.length === 0) {
            const folderDef = config.folders[folderId];
            const grandParentId = folderDef?.parentId;

            await onDeleteFolder(folderId);

            if (grandParentId) {
                await cleanEmptyFolders(grandParentId);
            }
        }
    }

    // ─── Unwrap Folder ──────────────────────────────────────────────────
    async function handleUnwrapFolder(folderId: string) {
        const folderDef = config.folders[folderId];
        if (!folderDef) return;
        const parentDest = folderDef.parentId;

        const { childRefs, childFolders } = getChildrenOf(folderId);

        for (const ref of childRefs) {
            await onMoveItem(ref.id, parentDest, ref.sortOrder);
        }

        for (const subF of childFolders) {
            await onUpdateFolder(subF.id, { parentId: parentDest });
        }

        await onDeleteFolder(folderId);
    }

    // ─── Local Folder Interactions ─────────────────────────────────────
    function startRename(folderDef: FolderDef) {
        editingFolderId = folderDef.id;
        renameValue = folderDef.name;
    }

    async function saveRename(folderDef: FolderDef) {
        const val = renameValue.trim();
        if (val && val !== folderDef.name) {
            await onUpdateFolder(folderDef.id, { name: val });
        }
        editingFolderId = null;
    }

    function toggleCollapse(folderId: string) {
        const current = ctx.collapsedFolders[folderId] ?? true;
        ctx.collapsedFolders = {
            ...ctx.collapsedFolders,
            [folderId]: !current
        };
    }
</script>

{#snippet folderIcon(params: { folder: FolderDef; collapsed: boolean; sizeClass?: string })}
    {@const { folder: f, collapsed, sizeClass = 'size-12' } = params}
    <div
        class="flex {sizeClass} shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-foreground {f.color
            ? COLOR_CLASSES[f.color]
            : ''}"
    >
        {#if collapsed}
            <Folder strokeWidth={2.5} class="size-5 text-inherit" />
        {:else}
            <FolderOpen strokeWidth={2.5} class="size-5 text-inherit" />
        {/if}
    </div>
{/snippet}

{#snippet folderName(params: { folder: FolderDef })}
    {@const { folder: f } = params}
    {#if editingFolderId === f.id}
        <form
            class="flex items-center gap-1.5 w-full"
            onsubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                saveRename(f);
            }}
        >
            <Input
                bind:value={renameValue}
                class="h-7 text-xs bg-background text-foreground w-full"
                autofocus
                onclick={(e) => e.stopPropagation()}
                onblur={() => saveRename(f)}
                onkeydown={(e) => {
                    if (e.key === 'Escape') {
                        editingFolderId = null;
                        e.stopPropagation();
                    }
                }}
            />
        </form>
    {:else}
        <span class="truncate text-foreground">{f.name}</span>
    {/if}
{/snippet}

{#snippet folderActions(params: { folder: FolderDef })}
    {@const { folder: f } = params}
    <div
        role="none"
        class="opacity-0 group-hover/folder:opacity-100 focus-within:opacity-100 transition-opacity"
        onclick={(e) => e.stopPropagation()}
    >
        <DropdownMenu.Root>
            <DropdownMenu.Trigger>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    class="size-7 hover:bg-muted-foreground/10 text-inherit"
                >
                    <MoreVertical class="size-3.5" />
                </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
                align="end"
                class="w-48 bg-popover border border-border shadow-lg p-1 rounded-md"
            >
                <DropdownMenu.Item
                    onclick={() => startRename(f)}
                    class="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent hover:text-accent-foreground cursor-pointer"
                >
                    <Edit2 class="size-3.5" />
                    <span>Rename</span>
                </DropdownMenu.Item>

                <div class="border-t border-border my-1"></div>
                <div
                    class="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase flex items-center gap-1"
                >
                    <Palette class="size-3" />
                    <span>Folder Color</span>
                </div>
                <div class="grid grid-cols-4 gap-1 px-2 py-1.5">
                    {#each COLOR_PRESETS as colorName (colorName)}
                        <button
                            class="size-5 rounded-full border border-border transition-transform hover:scale-110 active:scale-95 cursor-pointer flex items-center justify-center
                                {COLOR_BG_CLASSES[colorName] || ''}
                                {f.color === colorName
                                ? 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                                : ''}"
                            title={colorName}
                            onclick={() => onUpdateFolder(f.id, { color: colorName })}
                        >
                        </button>
                    {/each}
                    <button
                        class="col-span-4 mt-1 text-[10px] text-center text-muted-foreground py-0.5 rounded hover:bg-muted"
                        onclick={() => onUpdateFolder(f.id, { color: '' })}
                    >
                        Reset Color
                    </button>
                </div>

                <div class="border-t border-border my-1"></div>
                <DropdownMenu.Item
                    onclick={() => handleUnwrapFolder(f.id)}
                    class="flex items-center gap-2 px-2 py-1.5 text-xs text-destructive rounded hover:bg-destructive/10 hover:text-destructive cursor-pointer"
                >
                    <Trash2 class="size-3.5" />
                    <span>Unwrap Folder</span>
                </DropdownMenu.Item>
            </DropdownMenu.Content>
        </DropdownMenu.Root>
    </div>
{/snippet}

{#snippet defaultFolder(payload: FolderSnippetPayload)}
    {@const { folder: f, collapsed, toggle, childCount, parts } = payload}
    {#if collapsed && layout === 'grid'}
        <div
            role="button"
            tabindex="0"
            class="relative group/folder flex w-full min-h-28 flex-col items-start rounded-lg border bg-card border-border text-foreground hover:bg-muted/50 p-4 text-left select-none cursor-pointer"
            onclick={toggle}
            onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') toggle();
            }}
        >
            <div class="flex w-full items-center gap-3">
                {@render parts.icon({ folder: f, collapsed })}
                <div class="min-w-0 flex-1">
                    <div class="flex items-center justify-between w-full">
                        <h2 class="truncate text-sm font-semibold text-foreground flex-1">
                            {@render parts.name({ folder: f })}
                        </h2>
                        <div class="ml-2">
                            {@render parts.actions({ folder: f })}
                        </div>
                    </div>
                    <p class="mt-0.5 truncate text-xs text-muted-foreground">
                        {childCount} item{childCount === 1 ? '' : 's'} inside
                    </p>
                </div>
            </div>
            <div class="mt-auto flex items-center gap-1 pt-5 text-xs text-muted-foreground">
                <FolderOpen strokeWidth={2.5} class="size-3.5" />
                Open folder
            </div>
        </div>
    {:else}
        <div
            role="button"
            tabindex="0"
            class="relative group/folder flex items-center justify-between rounded-md border p-2 text-sm select-none cursor-pointer transition-all duration-200 w-full {getFolderColorClass(
                f.color
            )}"
            onclick={toggle}
            onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') toggle();
            }}
        >
            <div class="flex items-center gap-2 min-w-0 flex-1">
                {@render parts.icon({
                    folder: f,
                    collapsed,
                    sizeClass: 'size-6 rounded bg-transparent'
                })}
                <div class="flex-1 min-w-0">
                    {@render parts.name({ folder: f })}
                </div>
            </div>
            <div class="ml-2">
                {@render parts.actions({ folder: f })}
            </div>
        </div>
    {/if}
{/snippet}

{#snippet dragIndicator(
    activeId: string,
    nodeType: 'folder' | 'entity',
    isCollapsed: boolean = false
)}
    {#if ctx.dragOverId === activeId}
        {#if ctx.dragOverZone === 'before'}
            {#if layout === 'grid' && nodeType === 'entity'}
                <div
                    class="absolute top-0 bottom-0 left-0 w-[3px] bg-primary z-50 pointer-events-none rounded-full"
                ></div>
            {:else}
                <div
                    class="absolute top-0 left-0 right-0 h-[3px] bg-primary z-50 pointer-events-none rounded-full"
                ></div>
            {/if}
        {:else if ctx.dragOverZone === 'after' && (nodeType === 'entity' || isCollapsed)}
            {#if layout === 'grid' && nodeType === 'entity'}
                <div
                    class="absolute top-0 bottom-0 right-0 w-[3px] bg-primary z-50 pointer-events-none rounded-full"
                ></div>
            {:else}
                <div
                    class="absolute bottom-0 left-0 right-0 h-[3px] bg-primary z-50 pointer-events-none rounded-full"
                ></div>
            {/if}
        {/if}
    {/if}
{/snippet}

<div class="relative flex flex-col w-full {ctx.draggedId ? 'drag-active' : ''}">
    <div class={layout === 'grid' ? gridClass : listClass}>
        {#each visualItems as visualNode (visualNode.id)}
            {#if visualNode.type === 'folder'}
                {@const isCollapsed = ctx.collapsedFolders[visualNode.id] ?? true}
                {@const f = visualNode.folder!}

                <div class={layout === 'grid' && !isCollapsed ? 'col-span-full' : ''}>
                    <div
                        role="none"
                        draggable={dragSuppressedId !== visualNode.id}
                        onpointerdown={(e) => handlePointerDown(e, visualNode.id)}
                        onpointerup={clearDragSuppression}
                        onpointercancel={clearDragSuppression}
                        ondragstart={(e) => handleDragStart(e, visualNode)}
                        ondragover={(e) => handleDragOver(e, visualNode)}
                        ondragleave={(e) => handleDragLeave(e, visualNode)}
                        ondrop={(e) => handleDrop(e, visualNode)}
                        ondragend={resetDragState}
                        class={folderWrapperClass
                            ? folderWrapperClass(f, isCollapsed)
                            : `relative transition-all duration-200 drop-target w-full ${layout === 'grid' ? 'p-1.5' : 'py-0.5'}`}
                    >
                        <div
                            class="relative w-full rounded transition-all duration-200
                            {ctx.dragOverId === f.id && ctx.dragOverZone === 'overlap'
                                ? 'ring-2 ring-primary/60 bg-primary/5'
                                : ''}"
                        >
                            {@render (folderSnippet ?? defaultFolder)({
                                folder: f,
                                collapsed: isCollapsed,
                                toggle: () => toggleCollapse(f.id),
                                childCount: visualNode.childCount ?? 0,
                                parts: {
                                    icon: folderIcon,
                                    name: folderName,
                                    actions: folderActions
                                }
                            })}
                        </div>

                        {@render dragIndicator(f.id, 'folder', isCollapsed)}
                    </div>
                </div>

                {#if !isCollapsed}
                    <!-- Nested recursive call for children -->
                    <div class={layout === 'grid' ? 'col-span-full' : ''}>
                        <div
                            role="none"
                            class="{childContainerClass} {getFolderGroupClass(f.color)}"
                            ondragover={(e) => handleNestedDragOver(e, f.id)}
                            ondragleave={(e) => handleNestedDragLeave(e, f.id)}
                            ondrop={(e) => handleNestedDrop(e, f.id)}
                        >
                            <EntityList
                                {entities}
                                {config}
                                {layout}
                                {gridClass}
                                {listClass}
                                {childContainerClass}
                                {folderWrapperClass}
                                {itemWrapperClass}
                                parentId={f.id}
                                {onCreateFolder}
                                {onUpdateFolder}
                                {onDeleteFolder}
                                {onMoveItem}
                                item={itemSnippet}
                                folder={folderSnippet}
                                empty={emptySnippet}
                            />
                            {#if ctx.dragOverId === f.id && ctx.dragOverZone === 'after'}
                                <div
                                    class="absolute bottom-0 left-0 right-0 h-[3px] bg-primary z-50 pointer-events-none rounded-full"
                                ></div>
                            {/if}
                        </div>
                    </div>
                {/if}
            {:else}
                <!-- Entity Row or Grid Card -->
                {@const entity = visualNode.entity!}
                <div
                    draggable={dragSuppressedId !== visualNode.id}
                    onpointerdown={(e) => handlePointerDown(e, visualNode.id)}
                    onpointerup={clearDragSuppression}
                    onpointercancel={clearDragSuppression}
                    ondragstart={(e) => handleDragStart(e, visualNode)}
                    ondragover={(e) => handleDragOver(e, visualNode)}
                    ondragleave={(e) => handleDragLeave(e, visualNode)}
                    ondrop={(e) => handleDrop(e, visualNode)}
                    ondragend={resetDragState}
                    role="none"
                    class={itemWrapperClass
                        ? itemWrapperClass(entity)
                        : `relative transition-all duration-200 drop-target w-full ${layout === 'grid' ? 'p-1.5' : 'py-0.5'}`}
                >
                    <div
                        class="relative w-full rounded transition-all duration-200
                        {ctx.dragOverId === entity.id && ctx.dragOverZone === 'overlap'
                            ? 'ring-2 ring-primary/60 bg-primary/10 rounded scale-[1.01]'
                            : ''}"
                    >
                        {@render itemSnippet({ entity })}
                    </div>

                    {@render dragIndicator(entity.id, 'entity')}
                </div>
            {/if}
        {/each}
        {#if visualItems.length === 0 && emptySnippet}
            <div class="col-span-full w-full">
                {@render emptySnippet()}
            </div>
        {/if}
    </div>
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
