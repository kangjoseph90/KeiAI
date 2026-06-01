<script lang="ts">
    import { Plus, Trash2, Pencil } from 'lucide-svelte';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Badge } from '$lib/components/ui/badge';
    import { Label } from '$lib/components/ui/label';
    import {
        createCharacterAsset,
        deleteCharacterAsset,
        updateCharacter,
        createCharacterFolder,
        updateCharacterFolder,
        deleteCharacterFolder,
        moveCharacterItem
    } from '$lib/stores';
    import type { Character } from '$lib/services';
    import type { AssetRef } from '$lib/types/refs';

    interface Props {
        character: Character;
    }

    let { character }: Props = $props();

    let fileInput = $state<HTMLInputElement>();
    let editingId = $state<string | null>(null);
    let editName = $state('');

    const assetRefs = $derived(Object.values(character.assets.refs));

    function startRename(ref: AssetRef) {
        editingId = ref.id;
        editName = ref.name;
    }

    async function saveRename(ref: AssetRef) {
        const val = editName.trim();
        if (val && val !== ref.name) {
            await updateCharacter(character.id, {
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
        fileInput?.click();
    }

    async function handleFileSelect(event: Event) {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        if (!file) return;
        await createCharacterAsset(character.id, file);
        target.value = '';
    }

    async function handleDelete(assetId: string) {
        await deleteCharacterAsset(character.id, assetId);
    }
</script>

<section class="space-y-4">
    <div class="flex items-center justify-between">
        <Label class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Assets
        </Label>
        <div class="flex items-center gap-2">
            <Badge variant="outline" class="text-[10px] font-mono">{assetRefs.length}</Badge>
            <Button variant="secondary" size="sm" class="gap-1" onclick={handleAdd}>
                <Plus class="size-3" /> Add
            </Button>
            <input
                bind:this={fileInput}
                type="file"
                accept="image/*"
                class="hidden"
                onchange={handleFileSelect}
            />
        </div>
    </div>

    <EntityList
        entities={assetRefs}
        config={character.assets}
        layout="list"
        onCreateFolder={(name, parentId, sortOrder) =>
            createCharacterFolder(character.id, 'assets', name, parentId, sortOrder)}
        onUpdateFolder={(id, changes) => updateCharacterFolder(character.id, 'assets', id, changes)}
        onDeleteFolder={(id) => deleteCharacterFolder(character.id, 'assets', id)}
        onMoveItem={(itemId, newFolderId, newSortOrder) =>
            moveCharacterItem(character.id, 'assets', itemId, newFolderId, newSortOrder)}
    >
        {#snippet empty()}
            <div class="rounded-md border border-dashed p-6 text-center">
                <p class="text-xs text-muted-foreground">
                    No assets. Click <strong>Add</strong> to upload an image or file.
                </p>
            </div>
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
                            scopeType: character.scopeType,
                            scopeId: character.scopeId,
                            ownerTable: 'characters',
                            ownerId: character.id,
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
