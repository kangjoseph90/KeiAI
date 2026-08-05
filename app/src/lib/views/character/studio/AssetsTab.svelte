<script lang="ts">
    import { Check, Pencil, Trash2, Upload, X } from 'lucide-svelte';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import MediaGalleryDialog from '$lib/components/MediaGalleryDialog.svelte';
    import type { MediaGalleryItem } from '$lib/components/MediaGalleryDialog.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import ListActionBar from '$lib/components/ListActionBar.svelte';
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
    import { MEDIA_ASSET_EXTENSIONS } from '$lib/types/asset';
    import { getErrorMessage } from '$lib/types/errors';
    import { appDialog } from '$lib/adapters/dialog';
    import { appConfirm, toast } from '$lib/ui';
    import { listItems } from '$lib/utils/ordering';

    interface Props {
        character: Character;
    }

    let { character }: Props = $props();

    let editingId = $state<string | null>(null);
    let editName = $state('');
    let busyAction = $state<string | null>(null);
    let galleryOpen = $state(false);
    let gallerySelectedId = $state<string | undefined>();
    let galleryItems = $derived<MediaGalleryItem[]>(
        listItems(character.assets).map((ref) => ({
            id: ref.id,
            name: ref.name,
            asset: {
                scopeType: character.scopeType,
                scopeId: character.scopeId,
                ownerTable: 'characters',
                ownerId: character.id,
                hash: ref.hash,
                encKey: ref.encKey,
                mimeType: ref.mimeType
            }
        }))
    );

    function startRename(ref: AssetRef) {
        editingId = ref.id;
        editName = ref.name;
    }

    function cancelRename() {
        editingId = null;
        editName = '';
    }

    async function saveRename(ref: AssetRef) {
        if (busyAction) return;
        const val = editName.trim();
        if (!val) return;
        if (val === ref.name) return cancelRename();

        const characterId = character.id;
        busyAction = `rename:${ref.id}`;
        try {
            await updateCharacter(character.id, {
                assets: {
                    refs: {
                        [ref.id]: { ...ref, name: val }
                    }
                }
            });
            if (character.id === characterId) cancelRename();
        } catch (error) {
            toast.error({ title: 'Could not rename asset', description: getErrorMessage(error) });
        } finally {
            busyAction = null;
        }
    }

    async function handleAdd() {
        if (busyAction) return;
        const characterId = character.id;
        busyAction = 'upload';
        try {
            const files = await appDialog.openMultipleFiles({
                title: 'Upload Character Asset',
                filters: [
                    {
                        name: 'Images, audio, and video',
                        extensions: [...MEDIA_ASSET_EXTENSIONS]
                    }
                ]
            });
            if (!files?.length || character.id !== characterId) return;
            let uploadError: unknown;
            for (const file of files) {
                if (character.id !== characterId) return;
                try {
                    await createCharacterAsset(characterId, file);
                } catch (error) {
                    uploadError ??= error;
                }
            }
            if (uploadError) throw uploadError;
        } catch (error) {
            toast.error({ title: 'Could not upload asset', description: getErrorMessage(error) });
        } finally {
            busyAction = null;
        }
    }

    async function handleDelete(ref: AssetRef) {
        if (busyAction) return;
        const characterId = character.id;
        busyAction = `delete:${ref.id}`;
        try {
            const confirmed = await appConfirm({
                title: 'Delete character asset?',
                description: `Delete "${ref.name}"?`,
                confirmText: 'Delete',
                variant: 'destructive'
            });
            if (!confirmed || character.id !== characterId) return;
            await deleteCharacterAsset(characterId, ref.id);
        } catch (error) {
            toast.error({ title: 'Could not delete asset', description: getErrorMessage(error) });
        } finally {
            busyAction = null;
        }
    }

    function openGallery(ref: AssetRef): void {
        gallerySelectedId = ref.id;
        galleryOpen = true;
    }
</script>

<section class="space-y-4">
    <ListActionBar description="Images, audio, and video used by this character.">
        <Button
            size="sm"
            class="gap-1.5"
            disabled={busyAction !== null}
            aria-busy={busyAction === 'upload'}
            onclick={handleAdd}
        >
            <Upload class="size-4" /> Upload
        </Button>
    </ListActionBar>
    <EntityList
        entities={listItems(character.assets)}
        config={character.assets}
        layout="list"
        onCreateFolder={(name, parentId, sortOrder) =>
            createCharacterFolder(character.id, 'assets', name, parentId, sortOrder)}
        onUpdateFolder={(id, changes) => updateCharacterFolder(character.id, 'assets', id, changes)}
        onDeleteFolder={(id) => deleteCharacterFolder(character.id, 'assets', id)}
        onMoveItem={(itemId, newFolderId, newSortOrder) =>
            moveCharacterItem(character.id, 'assets', itemId, newFolderId, newSortOrder)}
        onItemClick={openGallery}
    >
        {#snippet empty()}
            <EmptyListPlaceholder message="No assets. Upload an image, audio, or video file." />
        {/snippet}
        {#snippet item({ entity: ref })}
            <div
                class="group flex min-h-13 items-center gap-2 rounded-lg border border-foreground/15 bg-card px-3 py-2 cursor-zoom-in text-card-foreground transition-colors hover:border-foreground/25"
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
                            encKey: ref.encKey,
                            mimeType: ref.mimeType
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
                                disabled={busyAction !== null}
                                class="h-7 text-xs bg-background w-full"
                                autofocus
                                onkeydown={(e) => {
                                    if (e.key === 'Escape') {
                                        cancelRename();
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
                    class={editingId === ref.id
                        ? 'flex items-center gap-2'
                        : 'touch-visible flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100'}
                >
                    {#if editingId === ref.id}
                        <Button
                            size="icon-sm"
                            title="Save"
                            aria-label={`Save ${ref.name} name`}
                            disabled={busyAction !== null || !editName.trim()}
                            aria-busy={busyAction === `rename:${ref.id}`}
                            onclick={() => saveRename(ref)}
                        >
                            <Check class="size-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            title="Cancel"
                            aria-label={`Cancel renaming ${ref.name}`}
                            disabled={busyAction !== null}
                            onclick={cancelRename}
                        >
                            <X class="size-3.5" />
                        </Button>
                    {:else}
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            title="Rename"
                            aria-label={`Rename ${ref.name}`}
                            disabled={busyAction !== null}
                            onclick={() => startRename(ref)}
                        >
                            <Pencil class="size-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            class="text-destructive hover:text-destructive"
                            title="Delete"
                            aria-label={`Delete ${ref.name}`}
                            disabled={busyAction !== null}
                            aria-busy={busyAction === `delete:${ref.id}`}
                            onclick={() => handleDelete(ref)}
                        >
                            <Trash2 class="size-3.5" />
                        </Button>
                    {/if}
                </div>
            </div>
        {/snippet}
    </EntityList>
</section>

<MediaGalleryDialog
    bind:open={galleryOpen}
    bind:selectedId={gallerySelectedId}
    items={galleryItems}
    title={`${character.name} assets`}
/>
