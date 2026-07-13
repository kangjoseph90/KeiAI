<script lang="ts">
    import { Check, Library, Search, UserRoundPlus, UsersRound } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
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
    import type { EntityListConfig } from '$lib/types/refs';

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
            adding = false;
        }
    }
</script>

<Dialog bind:open>
    <DialogContent
        class="grid h-[min(42rem,calc(100vh-2rem))] max-w-[calc(100%-2rem)] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-2xl"
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
                    gridClass="grid grid-cols-2 gap-1 sm:grid-cols-3"
                    childContainerClass="relative mt-1 border-l pl-3"
                    itemWrapperClass={() => 'min-w-0 p-1'}
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
                            class="group/item flex w-full min-w-0 items-center gap-3 rounded-md border p-2 text-left transition-[border-color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {isAttached
                                ? 'border-transparent bg-muted/50 text-muted-foreground'
                                : isSelected
                                  ? 'border-primary bg-primary/5 shadow-sm'
                                  : 'border-transparent hover:border-border hover:bg-muted/40'}"
                            disabled={isAttached || adding}
                            aria-pressed={isSelected}
                            onclick={() => toggle(resource.id)}
                        >
                            <div
                                class="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-sm font-semibold text-foreground"
                            >
                                {#if resource.avatar}
                                    <AssetView
                                        asset={{
                                            scopeType: resource.scopeType,
                                            scopeId: resource.scopeId,
                                            ownerTable,
                                            ownerId: resource.id,
                                            hash: resource.avatar.hash,
                                            encKey: resource.avatar.encKey
                                        }}
                                        alt={resource.name}
                                        class="size-full"
                                    />
                                {:else}
                                    {initial(resource.name)}
                                {/if}
                            </div>

                            <div class="min-w-0 flex-1">
                                <p class="truncate text-sm font-medium text-foreground">
                                    {resource.name}
                                </p>
                                <p class="mt-0.5 text-[11px] text-muted-foreground">
                                    {isAttached ? 'Added' : isSelected ? 'Selected' : 'Available'}
                                </p>
                            </div>

                            <span
                                class="flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors {isAttached ||
                                isSelected
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : 'border-muted-foreground/30 text-transparent group-hover/item:border-muted-foreground/60'}"
                                aria-hidden="true"
                            >
                                <Check class="size-3" strokeWidth={3} />
                            </span>
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
