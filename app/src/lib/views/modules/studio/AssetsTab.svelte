<script lang="ts">
    import { Check, Pencil, Trash2, Upload, X } from 'lucide-svelte';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import MediaView from '$lib/components/MediaView.svelte';
    import AssetViewerDialog from '$lib/components/AssetViewerDialog.svelte';
    import type { AssetViewerItem } from '$lib/components/AssetViewerDialog.svelte';
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
        moveModuleItem,
        userId,
        t
    } from '$lib/stores';
    import type { Module } from '$lib/services';
    import type { AssetRef } from '$lib/types/refs';
    import { MEDIA_ASSET_EXTENSIONS } from '$lib/types/asset';
    import { getErrorMessage } from '$lib/types/errors';
    import { appDialog } from '$lib/adapters/dialog';
    import { appConfirm, toast } from '$lib/ui';
    import { listItems } from '$lib/utils/ordering';

    interface Props {
        module: Module;
    }

    let { module }: Props = $props();

    let editingId = $state<string | null>(null);
    let editName = $state('');
    let busyAction = $state<string | null>(null);
    let galleryOpen = $state(false);
    let gallerySelectedId = $state<string | undefined>();
    let galleryItems = $derived<AssetViewerItem[]>(
        listItems(module.assets).map((ref) => ({
            id: ref.id,
            name: ref.name,
            asset: {
                scopeType: 'user',
                scopeId: $userId ?? '',
                ownerTable: 'modules',
                ownerId: module.id,
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

        const moduleId = module.id;
        busyAction = `rename:${ref.id}`;
        try {
            await updateModule(module.id, {
                assets: {
                    refs: {
                        [ref.id]: { ...ref, name: val }
                    }
                }
            });
            if (module.id === moduleId) cancelRename();
        } catch (error) {
            toast.error({
                title: $t('module.toast.renameAsset'),
                description: getErrorMessage(error)
            });
        } finally {
            busyAction = null;
        }
    }

    async function handleAdd() {
        if (busyAction) return;
        const moduleId = module.id;
        busyAction = 'upload';
        try {
            const files = await appDialog.openMultipleFiles({
                title: $t('module.assets.uploadTitle'),
                filters: [
                    {
                        name: 'Images, audio, and video',
                        extensions: [...MEDIA_ASSET_EXTENSIONS]
                    }
                ]
            });
            if (!files?.length || module.id !== moduleId) return;
            let uploadError: unknown;
            for (const file of files) {
                if (module.id !== moduleId) return;
                try {
                    await createModuleAsset(moduleId, file);
                } catch (error) {
                    uploadError ??= error;
                }
            }
            if (uploadError) throw uploadError;
        } catch (error) {
            toast.error({
                title: $t('module.toast.uploadAsset'),
                description: getErrorMessage(error)
            });
        } finally {
            busyAction = null;
        }
    }

    async function handleDelete(ref: AssetRef) {
        if (busyAction) return;
        const moduleId = module.id;
        busyAction = `delete:${ref.id}`;
        try {
            const confirmed = await appConfirm({
                title: $t('module.assets.deleteTitle'),
                description: $t('module.assets.deleteBody', { name: ref.name }),
                confirmText: $t('common.confirm.delete'),
                variant: 'destructive'
            });
            if (!confirmed || module.id !== moduleId) return;
            await deleteModuleAsset(moduleId, ref.id);
        } catch (error) {
            toast.error({
                title: $t('module.toast.deleteAsset'),
                description: getErrorMessage(error)
            });
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
    <ListActionBar description={$t('module.assets.description')}>
        <Button
            size="sm"
            class="gap-1.5"
            disabled={busyAction !== null}
            aria-busy={busyAction === 'upload'}
            onclick={handleAdd}
        >
            <Upload class="size-4" />
            {$t('module.assets.addButton')}
        </Button>
    </ListActionBar>
    <EntityList
        entities={listItems(module.assets)}
        config={module.assets}
        layout="list"
        onCreateFolder={(name, parentId, sortOrder) =>
            createModuleFolder(module.id, 'assets', name, parentId, sortOrder)}
        onUpdateFolder={(id, changes) => updateModuleFolder(module.id, 'assets', id, changes)}
        onDeleteFolder={(id) => deleteModuleFolder(module.id, 'assets', id)}
        onMoveItem={(itemId, newFolderId, newSortOrder) =>
            moveModuleItem(module.id, 'assets', itemId, newFolderId, newSortOrder)}
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
                    class="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted"
                >
                    <MediaView
                        asset={{
                            scopeType: 'user',
                            scopeId: $userId ?? '',
                            ownerTable: 'modules',
                            ownerId: module.id,
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
                            title={$t('module.assets.save')}
                            aria-label={$t('module.assets.saveNamed', { name: ref.name })}
                            disabled={busyAction !== null || !editName.trim()}
                            aria-busy={busyAction === `rename:${ref.id}`}
                            onclick={() => saveRename(ref)}
                        >
                            <Check class="size-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            title={$t('common.actions.cancel')}
                            aria-label={$t('module.assets.cancelRename', { name: ref.name })}
                            disabled={busyAction !== null}
                            onclick={cancelRename}
                        >
                            <X class="size-3.5" />
                        </Button>
                    {:else}
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            class="text-muted-foreground hover:bg-muted hover:text-foreground"
                            title={$t('module.assets.rename')}
                            aria-label={$t('module.assets.renameNamed', { name: ref.name })}
                            disabled={busyAction !== null}
                            onclick={() => startRename(ref)}
                        >
                            <Pencil class="size-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            class="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            title={$t('common.actions.delete')}
                            aria-label={$t('module.assets.deleteNamed', { name: ref.name })}
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

<AssetViewerDialog
    bind:open={galleryOpen}
    bind:selectedId={gallerySelectedId}
    items={galleryItems}
    title={$t('module.assets.galleryTitle', { name: module.name })}
/>
