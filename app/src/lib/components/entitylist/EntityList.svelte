<script lang="ts" generics="T extends { id: string }">
    import { getContext, setContext, tick, type Snippet } from 'svelte';
    import { flip } from 'svelte/animate';
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
    import { appPrompt, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';
    import { cn } from '$lib/utils';
    import { isInteractiveDragTarget, pointerDrag } from './pointer-drag';

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
        mode?: 'manage' | 'browse';
        parentId?: string;

        // Custom styling props for wrapper slots
        gridClass?: string;
        listClass?: string;
        childContainerClass?: string;
        folderWrapperClass?: (folder: FolderDef, isCollapsed: boolean) => string;
        itemWrapperClass?: (entity: T) => string;
        gridOverlapInset?: number;

        onCreateFolder?: (
            name: string,
            parentId?: string,
            sortOrder?: string
        ) => Promise<FolderDef>;
        onUpdateFolder?: (
            folderId: string,
            changes: Partial<{ name: string; color: string; parentId: string; sortOrder: string }>
        ) => Promise<void>;
        onDeleteFolder?: (folderId: string) => Promise<void>;
        onMoveItem?: (itemId: string, newFolderId?: string, newSortOrder?: string) => Promise<void>;
        onItemClick?: (entity: T) => void | Promise<void>;

        item: Snippet<[{ entity: T }]>;
        folder?: Snippet<[FolderSnippetPayload]>;
        empty?: Snippet;
    }

    let {
        entities,
        config,
        layout = 'list',
        mode = 'manage',
        parentId = undefined,
        gridClass = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 w-full',
        listClass = 'flex flex-col gap-1 w-full',
        childContainerClass = 'relative ml-3 my-1 px-2 py-1.5',
        folderWrapperClass = undefined,
        itemWrapperClass = undefined,
        gridOverlapInset = 0.3,
        onCreateFolder = async () => {
            throw new Error('Folder creation is unavailable in browse mode');
        },
        onUpdateFolder = async () => {
            throw new Error('Folder updates are unavailable in browse mode');
        },
        onDeleteFolder = async () => {
            throw new Error('Folder deletion is unavailable in browse mode');
        },
        onMoveItem = async () => {
            throw new Error('Item movement is unavailable in browse mode');
        },
        onItemClick = undefined,
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
        dropPending: boolean;
        animateReorder: boolean;
        collapsedFolders: Record<string, boolean>;
    }

    const CONTEXT_KEY = 'FolderListContextKey';

    const rootState = $state<SharedDragState>({
        draggedId: null,
        draggedType: null,
        draggedParentId: undefined,
        dragOverId: null,
        dragOverZone: null,
        dropPending: false,
        animateReorder: false,
        collapsedFolders: {}
    });

    const parentCtx = getContext<SharedDragState>(CONTEXT_KEY);
    if (!parentCtx) setContext(CONTEXT_KEY, rootState);
    const ctx = parentCtx ?? rootState;

    // Local states
    let editingFolderId = $state<string | null>(null);
    let renameValue = $state('');
    let openFolderMenuId = $state<string | null>(null);

    interface VisualItem {
        type: 'folder' | 'folder-contents' | 'entity';
        id: string;
        sortOrder: string | null;
        folder?: FolderDef;
        entity?: T;
        childCount?: number;
    }

    // ─── Visual Items Calculation ──────────────────────────────────────
    function buildVisualItems(forParentId: string | undefined): VisualItem[] {
        const currentFolders = Object.values(config.folders || {}).filter(
            (f) => f && f.parentId === forParentId
        );

        const currentEntities: T[] = [];
        const unreferredEntities: T[] = [];

        for (const ent of entities) {
            if (!ent) continue;
            const ref = config.refs?.[ent.id];
            if (!ref) {
                if (forParentId === undefined) {
                    unreferredEntities.push(ent);
                }
            } else if (ref.folderId === forParentId) {
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

            if (!(ctx.collapsedFolders[f.id] ?? true)) {
                items.push({
                    type: 'folder-contents',
                    id: `${f.id}__contents`,
                    sortOrder: f.sortOrder || null,
                    folder: f
                });
            }
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

        items.sort((a, b) => {
            const order = compareSortOrder(a.sortOrder, b.sortOrder);
            if (order !== 0) return order;
            if (a.folder?.id !== b.folder?.id) return 0;
            if (a.type === 'folder') return -1;
            if (b.type === 'folder') return 1;
            return 0;
        });

        for (const ent of unreferredEntities) {
            items.push({
                type: 'entity',
                id: ent.id,
                sortOrder: null,
                entity: ent
            });
        }

        return items;
    }

    const visualItems = $derived(buildVisualItems(parentId));

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
    function resetDragState() {
        ctx.draggedId = null;
        ctx.draggedType = null;
        ctx.draggedParentId = undefined;
        ctx.dragOverId = null;
        ctx.dragOverZone = null;
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

    function setDragTarget(
        target: HTMLElement,
        clientX: number,
        clientY: number,
        node: VisualItem,
        forcedZone?: 'before' | 'after' | 'overlap'
    ) {
        if (!isDragAllowed(ctx.draggedId, ctx.draggedType, node)) {
            ctx.dragOverId = null;
            ctx.dragOverZone = null;
            return;
        }

        const rect = target.getBoundingClientRect();
        let zone: 'before' | 'after' | 'overlap' = forcedZone ?? 'overlap';

        if (forcedZone) {
            ctx.dragOverId = node.id;
            ctx.dragOverZone = zone;
            return;
        }

        if (layout === 'list') {
            const pctY = (clientY - rect.top) / rect.height;
            if (pctY < 0.25) {
                zone = 'before';
            } else if (pctY > 0.75) {
                zone = 'after';
            }
        } else {
            const pctX = (clientX - rect.left) / rect.width;
            const pctY = (clientY - rect.top) / rect.height;
            const overlapInset = Math.min(0.45, Math.max(0, gridOverlapInset));
            if (pctX < overlapInset) {
                zone = 'before';
            } else if (pctX > 1 - overlapInset) {
                zone = 'after';
            } else if (pctY < overlapInset) {
                zone = 'before';
            } else if (pctY > 1 - overlapInset) {
                zone = 'after';
            }
        }

        ctx.dragOverId = node.id;
        ctx.dragOverZone = zone;
    }

    async function dropOnTarget(
        targetNode: VisualItem,
        targetParentId: string | undefined,
        siblings: VisualItem[]
    ) {
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
                const newFolderName = await appPrompt({
                    title: 'Create folder',
                    description: 'Enter a name for the new grouped folder.',
                    defaultValue: 'Grouped Folder'
                });
                if (!newFolderName) return;
                if (!targetNode.sortOrder) return;

                const newFolder = await onCreateFolder(
                    newFolderName,
                    targetParentId,
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
                } catch (error) {
                    await onDeleteFolder(newFolder.id);
                    throw error;
                }
            }
        } else {
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
                await onMoveItem(draggedId, targetParentId, newSortOrder);
            } else {
                await onUpdateFolder(draggedId, {
                    parentId: targetParentId,
                    sortOrder: newSortOrder
                });
            }
        }

        if (sourceParentId) {
            await cleanEmptyFolders(sourceParentId);
        }
    }

    function getPointerTarget(clientX: number, clientY: number) {
        const element = document
            .elementFromPoint(clientX, clientY)
            ?.closest<HTMLElement>('[data-entity-dnd-id]');
        if (!element) return null;

        const id = element.dataset.entityDndId;
        const type = element.dataset.entityDndType;
        if (!id || (type !== 'folder' && type !== 'entity')) return null;

        const targetParentId =
            type === 'folder' ? config.folders[id]?.parentId : config.refs[id]?.folderId;
        const siblings = buildVisualItems(targetParentId).filter(
            (candidate) => candidate.type !== 'folder-contents'
        );
        const node = siblings.find((candidate) => candidate.id === id && candidate.type === type);
        let forcedZone: 'overlap' | 'after' | undefined = undefined;
        if (element.dataset.entityDndZone === 'folder-contents') {
            const rect = element.getBoundingClientRect();
            const pctY = (clientY - rect.top) / rect.height;
            const pctX = (clientX - rect.left) / rect.width;
            if (layout === 'list') {
                forcedZone = pctY > 0.8 ? 'after' : 'overlap';
            } else {
                forcedZone = pctY > 0.8 || pctX > 0.8 ? 'after' : 'overlap';
            }
        }
        return node ? { element, node, targetParentId, siblings, forcedZone } : null;
    }

    function handlePointerDragMove(clientX: number, clientY: number) {
        const target = getPointerTarget(clientX, clientY);
        if (!target) {
            ctx.dragOverId = null;
            ctx.dragOverZone = null;
            return null;
        }
        setDragTarget(target.element, clientX, clientY, target.node, target.forcedZone);
        return target;
    }

    async function handlePointerDrop(clientX: number, clientY: number) {
        if (ctx.dropPending) return;
        const target = handlePointerDragMove(clientX, clientY);
        if (!target) {
            resetDragState();
            return;
        }
        ctx.dropPending = true;
        ctx.animateReorder = true;
        try {
            await dropOnTarget(target.node, target.targetParentId, target.siblings);
            await tick();
        } catch (error) {
            toast.error({
                title: 'Could not move item',
                description: getErrorMessage(error)
            });
        } finally {
            ctx.animateReorder = false;
            ctx.dropPending = false;
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
    {#if mode === 'manage'}
        <div
            role="none"
            class="touch-visible opacity-0 transition-opacity group-hover/folder:opacity-100 has-focus-visible:opacity-100 {openFolderMenuId ===
            f.id
                ? 'opacity-100'
                : ''}"
            onclick={(e) => e.stopPropagation()}
        >
            <DropdownMenu.Root
                open={openFolderMenuId === f.id}
                onOpenChange={(open) => (openFolderMenuId = open ? f.id : null)}
            >
                <DropdownMenu.Trigger>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        class="size-7 rounded-full border border-border/60 bg-background/85 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-background hover:text-foreground dark:hover:bg-background/95"
                        aria-label={`Actions for ${f.name}`}
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
                                aria-label={`Set folder color to ${colorName}`}
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
    {/if}
{/snippet}

{#snippet defaultFolder(payload: FolderSnippetPayload)}
    {@const { folder: f, collapsed, toggle, childCount, parts } = payload}
    {#if layout === 'grid'}
        <div
            role="button"
            tabindex="0"
            aria-expanded={!collapsed}
            aria-label={f.name}
            class="relative group/folder flex w-full min-h-32 flex-col items-start rounded-lg border bg-card border-border text-foreground hover:bg-muted/50 p-4 text-left select-none cursor-pointer"
            onclick={toggle}
            onkeydown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                toggle();
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
                {#if collapsed}
                    <FolderOpen strokeWidth={2.5} class="size-3.5" />
                    Open folder
                {:else}
                    <Folder strokeWidth={2.5} class="size-3.5" />
                    Close folder
                {/if}
            </div>
        </div>
    {:else}
        <div
            role="button"
            tabindex="0"
            aria-expanded={!collapsed}
            aria-label={f.name}
            class="relative group/folder flex min-h-13 w-full cursor-pointer select-none items-center justify-between rounded-lg border border-foreground/15 px-3 py-2 text-sm transition-[border-color,background-color] hover:border-foreground/25 {getFolderColorClass(
                f.color
            )}"
            onclick={toggle}
            onkeydown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                toggle();
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
            {#if layout === 'grid'}
                <div
                    class="absolute top-0 bottom-0 -left-0.5 w-0.5 bg-primary/60 z-50 pointer-events-none rounded-full"
                ></div>
            {:else}
                <div
                    class="absolute top-0 left-0 right-0 h-0.5 bg-primary/60 z-50 pointer-events-none rounded-full"
                ></div>
            {/if}
        {:else if ctx.dragOverZone === 'after' && (nodeType === 'entity' || isCollapsed || layout === 'grid')}
            {#if layout === 'grid'}
                <div
                    class="absolute top-0 bottom-0 -right-0.5 w-0.5 bg-primary/60 z-50 pointer-events-none rounded-full"
                ></div>
            {:else}
                <div
                    class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/60 z-50 pointer-events-none rounded-full"
                ></div>
            {/if}
        {/if}
    {/if}
{/snippet}

<div
    class="relative flex flex-col w-full {ctx.draggedId ? 'drag-active' : ''}"
    aria-busy={ctx.dropPending}
>
    <div class={layout === 'grid' ? cn(gridClass, 'grid-flow-dense') : listClass}>
        {#each visualItems as visualNode (visualNode.id)}
            <div
                animate:flip={{ duration: ctx.animateReorder ? 150 : 0 }}
                class={layout === 'grid' && visualNode.type === 'folder-contents'
                    ? 'col-span-full w-full'
                    : 'w-full'}
            >
                {#if visualNode.type === 'folder'}
                    {@const isCollapsed = ctx.collapsedFolders[visualNode.id] ?? true}
                    {@const f = visualNode.folder!}

                    <div
                        role="none"
                        data-entity-dnd-id={visualNode.id}
                        data-entity-dnd-type="folder"
                        use:pointerDrag={{
                            disabled: mode === 'browse' || ctx.dropPending,
                            onStart: () => {
                                ctx.draggedId = visualNode.id;
                                ctx.draggedType = 'folder';
                                ctx.draggedParentId = parentId;
                            },
                            onMove: handlePointerDragMove,
                            onDrop: handlePointerDrop,
                            onCancel: resetDragState
                        }}
                        class={folderWrapperClass
                            ? folderWrapperClass(f, isCollapsed)
                            : 'relative w-full drop-target'}
                    >
                        <div
                            class="relative w-full rounded transition-[background-color,box-shadow] duration-150
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
                {:else if visualNode.type === 'folder-contents'}
                    {@const f = visualNode.folder!}
                    <div class="w-full overflow-hidden">
                        <div
                            role="none"
                            data-entity-dnd-id={f.id}
                            data-entity-dnd-type="folder"
                            data-entity-dnd-zone="folder-contents"
                            class={cn('min-w-0', childContainerClass, getFolderGroupClass(f.color))}
                        >
                            <EntityList
                                {entities}
                                {config}
                                {layout}
                                {mode}
                                {gridClass}
                                {listClass}
                                {childContainerClass}
                                {folderWrapperClass}
                                {itemWrapperClass}
                                {gridOverlapInset}
                                parentId={f.id}
                                {onCreateFolder}
                                {onUpdateFolder}
                                {onDeleteFolder}
                                {onMoveItem}
                                {onItemClick}
                                item={itemSnippet}
                                folder={folderSnippet}
                                empty={emptySnippet}
                            />
                            {#if layout === 'list' && ctx.dragOverId === f.id && ctx.dragOverZone === 'after'}
                                <div
                                    class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/60 z-50 pointer-events-none rounded-full"
                                ></div>
                            {/if}
                        </div>
                    </div>
                {:else}
                    <!-- Entity Row or Grid Card -->
                    {@const entity = visualNode.entity!}
                    <div
                        data-entity-dnd-id={visualNode.id}
                        data-entity-dnd-type="entity"
                        use:pointerDrag={{
                            disabled: mode === 'browse' || ctx.dropPending,
                            onStart: () => {
                                ctx.draggedId = visualNode.id;
                                ctx.draggedType = 'entity';
                                ctx.draggedParentId = parentId;
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
                        class="{itemWrapperClass
                            ? itemWrapperClass(entity)
                            : 'relative w-full drop-target'} select-none"
                    >
                        <div
                            class="relative w-full rounded transition-[background-color,box-shadow] duration-150
                            {ctx.dragOverId === entity.id && ctx.dragOverZone === 'overlap'
                                ? 'ring-2 ring-primary/60 bg-primary/5'
                                : ''}"
                        >
                            {@render itemSnippet({ entity })}
                        </div>

                        {@render dragIndicator(entity.id, 'entity')}
                    </div>
                {/if}
            </div>
        {/each}
        {#if visualItems.length === 0 && emptySnippet}
            <div class="col-span-full w-full">
                {@render emptySnippet()}
            </div>
        {/if}
    </div>
</div>

<style>
    :global(.drag-active) .drop-target > * {
        pointer-events: none !important;
    }
    :global(.pointer-drag-source) {
        opacity: 0.4;
    }
</style>
