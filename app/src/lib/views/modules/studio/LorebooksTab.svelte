<script lang="ts">
    import { Plus } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import ListActionBar from '$lib/components/ListActionBar.svelte';
    import { defaultLorebookFields, type Lorebook } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import type { FolderDef, EntityListConfig } from '$lib/types/refs';
    import LorebookItem from '../LorebookItem.svelte';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import { generateSortOrder, listItems } from '$lib/utils/ordering';
    import { generateId } from '$lib/utils/id';

    interface Props {
        config: EntityListConfig<Lorebook>;
        onSave: (item: Lorebook) => void | Promise<void>;
        onDelete: (id: string) => void | Promise<void>;
        onCreateFolder: (name: string, parentId?: string, sortOrder?: string) => Promise<FolderDef>;
        onUpdateFolder: (
            folderId: string,
            changes: Partial<{ name: string; color: string; parentId: string; sortOrder: string }>
        ) => Promise<void>;
        onDeleteFolder: (folderId: string) => Promise<void>;
        onMoveItem: (itemId: string, newFolderId?: string, newSortOrder?: string) => Promise<void>;
    }

    let {
        config,
        onSave,
        onDelete,
        onCreateFolder,
        onUpdateFolder,
        onDeleteFolder,
        onMoveItem
    }: Props = $props();
    let editingId = $state<string | null>(null);

    async function handleAdd() {
        const lorebook: Lorebook = {
            ...defaultLorebookFields,
            depth: 0,
            id: generateId(),
            sortOrder: generateSortOrder(config.refs, config.folders)
        };
        await onSave(lorebook);
        editingId = lorebook.id;
    }

    async function handleUpdate(id: string, changes: DeepPartial<Lorebook>) {
        const item = config.refs[id];
        if (item) await onSave({ ...item, ...changes, id });
    }
</script>

<section class="space-y-4">
    <ListActionBar description="Context recalled during conversation generation.">
        <Button size="sm" class="gap-1.5" onclick={handleAdd}>
            <Plus class="size-4" /> Add
        </Button>
    </ListActionBar>

    <EntityList
        entities={listItems(config)}
        {config}
        layout="list"
        {onCreateFolder}
        {onUpdateFolder}
        {onDeleteFolder}
        {onMoveItem}
    >
        {#snippet empty()}
            <EmptyListPlaceholder message="No lorebooks." />
        {/snippet}
        {#snippet item({ entity: lb })}
            <LorebookItem
                item={lb}
                initiallyEditing={editingId === lb.id}
                onUpdate={handleUpdate}
                {onDelete}
            />
        {/snippet}
    </EntityList>
</section>
