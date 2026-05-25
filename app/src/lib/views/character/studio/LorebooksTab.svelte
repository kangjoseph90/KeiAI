<script lang="ts">
    import { Book, Plus } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import type { Lorebook } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import type { FolderDef, EntityListConfig } from '$lib/types/refs';
    import LorebookItem from '../../modules/LorebookItem.svelte';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';

    interface Props {
        lorebooks: Lorebook[];
        config: EntityListConfig;
        onCreate: (data: DeepPartial<Lorebook>) => void | Promise<void>;
        onUpdate: (id: string, changes: DeepPartial<Lorebook>) => void | Promise<void>;
        onDelete: (id: string) => void | Promise<void>;
        onCreateFolder: (name: string, parentId?: string) => Promise<FolderDef>;
        onUpdateFolder: (
            folderId: string,
            changes: Partial<{ name: string; color: string; parentId: string; sortOrder: string }>
        ) => Promise<void>;
        onDeleteFolder: (folderId: string) => Promise<void>;
        onMoveItem: (itemId: string, newFolderId?: string, newSortOrder?: string) => Promise<void>;
    }

    let {
        lorebooks,
        config,
        onCreate,
        onUpdate,
        onDelete,
        onCreateFolder,
        onUpdateFolder,
        onDeleteFolder,
        onMoveItem
    }: Props = $props();
    let newLorebookName = $state('');

    async function handleAdd() {
        if (!newLorebookName.trim()) return;
        await onCreate({
            name: newLorebookName,
            key: '',
            secondKey: '',
            content: '',
            depth: 0,
            disabled: false
        });
        newLorebookName = '';
    }
</script>

<section class="space-y-6">
    <div class="flex items-center justify-between">
        <div>
            <h2 class="text-lg font-semibold">World Info / Lorebooks</h2>
            <p class="text-sm text-muted-foreground">
                On-demand facts and lore triggered by keywords.
            </p>
        </div>
        <div class="flex gap-2">
            <Input
                placeholder="Lorebook name..."
                class="w-48 h-9"
                bind:value={newLorebookName}
                onkeydown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <Button size="sm" class="gap-1.5" onclick={handleAdd}>
                <Plus class="size-4" /> Add
            </Button>
        </div>
    </div>

    <EntityList
        entities={lorebooks}
        {config}
        layout="list"
        {onCreateFolder}
        {onUpdateFolder}
        {onDeleteFolder}
        {onMoveItem}
    >
        {#snippet item({ entity: lb })}
            <LorebookItem item={lb} {onUpdate} {onDelete} />
        {/snippet}
    </EntityList>
</section>
