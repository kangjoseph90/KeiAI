<script lang="ts">
    import { Check, Library, Search, UserRoundPlus, UsersRound } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import MediaEntityCard from '$lib/components/entitylist/MediaEntityCard.svelte';
    import { Button } from '$lib/components/ui/button';
    import {
        Dialog,
        DialogContent,
        DialogDescription,
        DialogFooter,
        DialogHeader,
        DialogTitle
    } from '$lib/components/ui/dialog';
    import { Input } from '$lib/components/ui/input';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import type { Character, Persona } from '$lib/services';
    import type { EntityListConfig, FolderDef } from '$lib/types/refs';
    import type { Snippet } from 'svelte';

    type PickerResource = Character | Persona;
    type ResourceTable = 'characters' | 'personas';

    interface Props {
        open: boolean;
        title: string;
        description: string;
        singularLabel: string;
        resourceLabel: string;
        resources: PickerResource[];
        config: EntityListConfig;
        attachedIds: string[];
        ownerTable: ResourceTable;
        onAdd: (ids: string[]) => Promise<void | boolean>;
        roomTabLabel?: string;
        libraryResources?: PickerResource[];
        libraryConfig?: EntityListConfig;
        onCopy?: (ids: string[]) => Promise<void | boolean>;
    }

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

    let {
        open = $bindable(),
        title,
        description,
        singularLabel,
        resourceLabel,
        resources,
        config,
        attachedIds,
        ownerTable,
        onAdd,
        roomTabLabel = `Room ${resourceLabel}`,
        libraryResources = undefined,
        libraryConfig = undefined,
        onCopy = undefined
    }: Props = $props();

    let source = $state<'room' | 'library'>('room');
    let query = $state('');
    let selectedIds = $state<string[]>([]);
    let adding = $state(false);
    let wasOpen = $state(false);

    const hasLibrarySource = $derived(Boolean(libraryResources && libraryConfig && onCopy));
    const activeResources = $derived(
        source === 'library' && libraryResources ? libraryResources : resources
    );
    const activeConfig = $derived(source === 'library' && libraryConfig ? libraryConfig : config);
    const attached = $derived(new Set(source === 'room' ? attachedIds : []));
    const normalizedQuery = $derived(query.trim().toLocaleLowerCase());
    const filteredResources = $derived(
        normalizedQuery
            ? activeResources.filter((resource) =>
                  resource.name.toLocaleLowerCase().includes(normalizedQuery)
              )
            : activeResources
    );
    const displayConfig = $derived<EntityListConfig>(
        normalizedQuery ? { refs: {}, folders: {} } : activeConfig
    );
    const actionVerb = $derived(source === 'library' ? 'Copy' : 'Add');
    const addButtonLabel = $derived(
        selectedIds.length === 0
            ? `${actionVerb} ${resourceLabel}`
            : `${actionVerb} ${selectedIds.length} ${selectedIds.length === 1 ? singularLabel : resourceLabel}`
    );

    $effect(() => {
        if (open && !wasOpen) {
            query = '';
            selectedIds = [];
            source = 'room';
            adding = false;
        }
        wasOpen = open;
    });

    function initial(name: string): string {
        return (name.trim().charAt(0) || '?').toUpperCase();
    }

    function toggle(resourceId: string): void {
        if (attached.has(resourceId) || adding) return;
        selectedIds = selectedIds.includes(resourceId)
            ? selectedIds.filter((id) => id !== resourceId)
            : [...selectedIds, resourceId];
    }

    function selectSource(nextSource: 'room' | 'library'): void {
        source = nextSource;
        query = '';
        selectedIds = [];
    }

    async function addSelected(): Promise<void> {
        if (selectedIds.length === 0 || adding) return;
        adding = true;
        try {
            let completed: void | boolean;
            if (source === 'library' && onCopy) {
                completed = await onCopy(selectedIds);
            } else {
                completed = await onAdd(selectedIds);
            }
            if (completed !== false) open = false;
        } finally {
            // Keep the progress label stable while a successful dialog close animates out.
            // Failed submissions stay open and must become interactive again immediately.
            if (open) adding = false;
        }
    }
</script>

{#snippet folderCard(payload: FolderSnippetPayload)}
    {@const { folder, collapsed, toggle, parts } = payload}
    <div
        role="button"
        tabindex="0"
        aria-expanded={!collapsed}
        aria-label={folder.name}
        class="group/folder relative w-full cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onclick={toggle}
        onkeydown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            toggle();
        }}
    >
        <MediaEntityCard name={folder.name} align="center" density="compact" class="cursor-pointer">
            {#snippet visual()}
                {@render parts.icon({
                    folder,
                    collapsed,
                    sizeClass: 'size-10 rounded-lg [&_svg]:size-4'
                })}
            {/snippet}
            {#snippet nameContent()}
                {@render parts.name({ folder })}
            {/snippet}
        </MediaEntityCard>
    </div>
{/snippet}

<Dialog bind:open>
    <DialogContent
        class="grid h-[min(42rem,var(--overlay-available-height))] max-w-[calc(100%-2rem)] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-2xl"
    >
        <DialogHeader class="border-b px-5 py-4 pr-12 text-left">
            <DialogTitle class="text-base">{title}</DialogTitle>
            <DialogDescription class="text-xs">{description}</DialogDescription>
        </DialogHeader>

        <div class="border-b bg-muted/20 px-5 py-3">
            {#if hasLibrarySource}
                <div class="mb-3 flex rounded-md border bg-background p-1">
                    <Button
                        variant={source === 'room' ? 'secondary' : 'ghost'}
                        size="sm"
                        class="h-8 flex-1 gap-2 text-xs"
                        onclick={() => selectSource('room')}
                    >
                        <UsersRound class="size-3.5" />
                        {roomTabLabel}
                    </Button>
                    <Button
                        variant={source === 'library' ? 'secondary' : 'ghost'}
                        size="sm"
                        class="h-8 flex-1 gap-2 text-xs"
                        onclick={() => selectSource('library')}
                    >
                        <Library class="size-3.5" /> Copy from library
                    </Button>
                </div>
            {/if}
            <div class="relative">
                <Search
                    class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                    bind:value={query}
                    class="h-9 bg-background pl-9 text-sm"
                    placeholder="Search {resourceLabel}..."
                    aria-label="Search {resourceLabel}"
                />
            </div>
        </div>

        <ScrollArea class="min-h-0">
            <div class="p-3 sm:p-4">
                <EntityList
                    entities={filteredResources}
                    config={displayConfig}
                    mode="browse"
                    layout="grid"
                    gridClass="grid w-full grid-cols-[repeat(auto-fit,8rem)] justify-center gap-2"
                    childContainerClass="relative my-2 rounded-xl border border-border/60 bg-muted/20 p-2"
                    itemWrapperClass={() => 'min-w-0'}
                    folder={folderCard}
                >
                    {#snippet empty()}
                        <div
                            class="flex min-h-56 flex-col items-center justify-center gap-2 px-6 text-center"
                        >
                            <div
                                class="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"
                            >
                                <UserRoundPlus class="size-5" />
                            </div>
                            <p class="text-sm font-medium">No {resourceLabel} found</p>
                            <p class="max-w-64 text-xs text-muted-foreground">
                                Try another search or create one from the library.
                            </p>
                        </div>
                    {/snippet}

                    {#snippet item({ entity: resource })}
                        {@const isAttached = attached.has(resource.id)}
                        {@const isSelected = selectedIds.includes(resource.id)}
                        <button
                            type="button"
                            class="group/item block w-full min-w-0 appearance-none border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            disabled={isAttached || adding}
                            aria-pressed={isSelected}
                            onclick={() => toggle(resource.id)}
                        >
                            <MediaEntityCard
                                name={resource.name}
                                align="center"
                                density="compact"
                                interactive={!isAttached && !adding && !isSelected}
                                class={isAttached
                                    ? 'border-transparent bg-muted/50 text-muted-foreground opacity-75'
                                    : isSelected
                                      ? 'border-primary bg-primary/5 shadow-sm'
                                      : ''}
                            >
                                {#snippet visual()}
                                    {#if resource.avatar}
                                        <AssetView
                                            asset={{
                                                scopeType: resource.scopeType,
                                                scopeId: resource.scopeId,
                                                ownerTable,
                                                ownerId: resource.id,
                                                hash: resource.avatar.hash,
                                                encKey: resource.avatar.encKey,
                                                mimeType: resource.avatar.mimeType
                                            }}
                                            alt={resource.name}
                                            class="size-full object-cover"
                                            focus="top"
                                        />
                                    {:else}
                                        {initial(resource.name)}
                                    {/if}

                                    <span
                                        class="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full border bg-background/85 text-transparent shadow-sm backdrop-blur-sm transition-colors {isAttached ||
                                        isSelected
                                            ? 'border-primary bg-primary text-primary-foreground'
                                            : 'border-foreground/20 group-hover/item:border-foreground/50'}"
                                        aria-hidden="true"
                                    >
                                        <Check class="size-3" strokeWidth={3} />
                                    </span>
                                {/snippet}
                            </MediaEntityCard>
                        </button>
                    {/snippet}
                </EntityList>
            </div>
        </ScrollArea>

        <DialogFooter class="flex-row items-center justify-between gap-3 border-t px-5 py-3">
            <p class="text-xs text-muted-foreground">
                {selectedIds.length === 0
                    ? `Select ${resourceLabel} to ${source === 'library' ? 'copy' : 'add'}`
                    : `${selectedIds.length} selected`}
            </p>
            <div class="flex items-center gap-2">
                <Button variant="ghost" onclick={() => (open = false)} disabled={adding}>
                    Cancel
                </Button>
                <Button onclick={addSelected} disabled={selectedIds.length === 0 || adding}>
                    {adding ? (source === 'library' ? 'Copying...' : 'Adding...') : addButtonLabel}
                </Button>
            </div>
        </DialogFooter>
    </DialogContent>
</Dialog>
