<script lang="ts">
    import { Upload, Trash2, Pencil } from 'lucide-svelte';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import ListActionBar from '$lib/components/ListActionBar.svelte';
    import {
        createModuleAsset,
        deleteModuleAsset,
        updateModule,
        createModuleFolder,
        updateModuleFolder,
        deleteModuleFolder,
        moveModuleItem
    } from '$lib/stores';
    import type { Module } from '$lib/services';
    import type { AssetRef } from '$lib/types/refs';
    import { appDialog } from '$lib/adapters/dialog';

    interface Props {
        module: Module;
    }

    let { module }: Props = $props();

    let editingId = $state<string | null>(null);
    let editName = $state('');

    const assetRefs = $derived(Object.values(module.assets.refs));

    function startRename(ref: AssetRef) {
        editingId = ref.id;
        editName = ref.name;
    }

    async function saveRename(ref: AssetRef) {
        const val = editName.trim();
        if (val && val !== ref.name) {
            await updateModule(module.id, {
                assets: {
                    refs: {
                        [ref.id]: { ...ref, name: val }
                    }
                }
            });
        }
        editingId = null;
    }

    async function handleAdd() {
        const file = await appDialog.openFile({
            title: 'Upload Module Asset',
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
        });
        if (!file) return;
        await createModuleAsset(module.id, file);
    }

    async function handleDelete(assetId: string) {
        await deleteModuleAsset(module.id, assetId);
    }
</script>

<section class="space-y-4">
    <ListActionBar description="Images and files used by this module.">
        <Button size="sm" class="gap-1.5" onclick={handleAdd}>
            <Upload class="size-4" /> Upload
        </Button>
    </ListActionBar>
    <EntityList
        entities={assetRefs}
        config={module.assets}
        layout="list"
        onCreateFolder={(name, parentId, sortOrder) =>
            createModuleFolder(module.id, 'assets', name, parentId, sortOrder)}
        onUpdateFolder={(id, changes) => updateModuleFolder(module.id, 'assets', id, changes)}
        onDeleteFolder={(id) => deleteModuleFolder(module.id, 'assets', id)}
        onMoveItem={(itemId, newFolderId, newSortOrder) =>
            moveModuleItem(module.id, 'assets', itemId, newFolderId, newSortOrder)}
    >
        {#snippet empty()}
            <EmptyListPlaceholder message="No assets. Use Upload to add an image or file." />
        {/snippet}
        {#snippet item({ entity: ref })}
            <div
                class="group flex items-center gap-3 rounded-md border bg-background p-2 transition-colors hover:bg-muted/50"
            >
                <div
                    class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted"
                >
                    <AssetView
                        asset={{
                            scopeType: 'user',
                            scopeId: '',
                            ownerTable: 'modules',
                            ownerId: module.id,
                            hash: ref.hash,
                            encKey: ref.encKey
                        }}
                        alt={ref.name}
                        class="size-full object-cover"
                        fallback="icon"
                    />
                </div>
                <div class="min-w-0 flex-1">
                    {#if editingId === ref.id}
                        <form
                            class="flex items-center gap-1.5"
                            onsubmit={(e) => {
                                e.preventDefault();
                                saveRename(ref);
                            }}
                        >
                            <Input
                                bind:value={editName}
                                class="h-7 text-xs bg-background w-full"
                                autofocus
                                onblur={() => saveRename(ref)}
                                onkeydown={(e) => {
                                    if (e.key === 'Escape') {
                                        editingId = null;
                                    }
                                }}
                            />
                        </form>
                    {:else}
                        <span class="truncate text-sm">{ref.name}</span>
                        <span class="text-[10px] text-muted-foreground ml-2 font-mono"
                            >{ref.mimeType}</span
                        >
                    {/if}
                </div>
                <div
                    class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        class="size-7"
                        title="Rename"
                        onclick={() => startRename(ref)}
                    >
                        <Pencil class="size-3" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        class="size-7 text-destructive hover:text-destructive"
                        title="Delete"
                        onclick={() => handleDelete(ref.id)}
                    >
                        <Trash2 class="size-3" />
                    </Button>
                </div>
            </div>
        {/snippet}
    </EntityList>
</section>
