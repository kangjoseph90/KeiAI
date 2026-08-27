<script lang="ts">
    import {
        Check,
        Image as ImageIcon,
        Settings2,
        Pencil,
        Plus,
        Trash2,
        Upload,
        UserRoundPen,
        X
    } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { WorkspaceShell } from '$lib/components/layout';
    import {
        Card,
        CardContent,
        CardDescription,
        CardHeader,
        CardTitle
    } from '$lib/components/ui/card';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Badge } from '$lib/components/ui/badge';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import SyntaxTextarea from '$lib/components/SyntaxTextarea.svelte';
    import MediaView from '$lib/components/MediaView.svelte';
    import AssetViewerDialog from '$lib/components/AssetViewerDialog.svelte';
    import type { AssetViewerItem } from '$lib/components/AssetViewerDialog.svelte';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import AdvancedTab from './AdvancedTab.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import {
        activeChat,
        activePersona,
        activeRoom,
        deletePersona,
        removePersonaAvatar,
        t,
        updatePersona,
        updatePersonaAvatar,
        createPersonaAsset,
        deletePersonaAsset,
        createPersonaFolder,
        updatePersonaFolder,
        deletePersonaFolder,
        movePersonaItem
    } from '$lib/stores';
    import { PERSONA_STUDIO_TABS, navigate, type PersonaStudioTab } from '$lib/router';
    import { isKeiServer } from '$lib/services';
    import { exportPersonaFile } from '$lib/managers/persona';
    import type { AssetRef } from '$lib/types/refs';
    import { IMAGE_ASSET_EXTENSIONS, MEDIA_ASSET_EXTENSIONS } from '$lib/types/asset';
    import { appDialog } from '$lib/adapters/dialog';
    import { appConfirm, runPorterOperation, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';
    import { listItems } from '$lib/utils/ordering';

    let { personaId, personaTab }: { personaId: string; personaTab?: PersonaStudioTab } = $props();

    let activeTab = $state<PersonaStudioTab>('profile');
    let editingId = $state<string | null>(null);
    let editName = $state('');
    let deleting = $state(false);
    let resourceAction = $state<string | null>(null);
    let galleryOpen = $state(false);
    let gallerySelectedId = $state<string | undefined>();
    let avatarGalleryOpen = $state(false);
    type ExportButton = 'risu' | 'keipersona-light' | 'keipersona-baked';
    let exporting = $state<ExportButton | null>(null);

    const TAB_ICONS = {
        profile: UserRoundPen,
        assets: ImageIcon,
        advanced: Settings2
    } satisfies Record<PersonaStudioTab, unknown>;
    const tabs = $derived(
        PERSONA_STUDIO_TABS.map((tab) => ({
            id: tab,
            label: $t(`persona.studio.tabs.${tab}`),
            icon: TAB_ICONS[tab]
        }))
    );

    $effect(() => {
        if (personaTab) activeTab = personaTab;
    });

    function openTab(tab: PersonaStudioTab) {
        activeTab = tab;
        navigate({ view: 'personaStudio', personaId, personaTab: tab });
    }

    function returnToTabs() {
        navigate({ view: 'personaStudio', personaId });
    }

    const assetRefs = $derived($activePersona ? listItems($activePersona.assets) : []);
    const galleryItems = $derived.by<AssetViewerItem[]>(() => {
        const persona = $activePersona;
        if (!persona) return [];
        return assetRefs.map((ref) => ({
            id: ref.id,
            name: ref.name,
            asset: {
                scopeType: persona.scopeType,
                scopeId: persona.scopeId,
                ownerTable: 'personas',
                ownerId: persona.id,
                hash: ref.hash,
                encKey: ref.encKey,
                mimeType: ref.mimeType
            }
        }));
    });
    const avatarGalleryItems = $derived.by<AssetViewerItem[]>(() => {
        const persona = $activePersona;
        if (!persona?.avatar) return [];
        return [
            {
                id: 'avatar',
                name: persona.avatar.name,
                asset: {
                    scopeType: persona.scopeType,
                    scopeId: persona.scopeId,
                    ownerTable: 'personas',
                    ownerId: persona.id,
                    hash: persona.avatar.hash,
                    encKey: persona.avatar.encKey,
                    mimeType: persona.avatar.mimeType
                }
            }
        ];
    });

    function backToContext() {
        if ($activeRoom && $activeChat) {
            navigate({ view: 'room', roomId: $activeRoom.id, chatId: $activeChat.id });
        } else if ($activeRoom) {
            navigate({ view: 'room', roomId: $activeRoom.id });
        } else {
            navigate({ view: 'home' });
        }
    }

    async function handleAvatarUpload() {
        if (!$activePersona || resourceAction) return;
        const personaId = $activePersona.id;
        resourceAction = 'avatar-upload';
        try {
            const file = await appDialog.openFile({
                title: $t('persona.profile.uploadAvatarTitle'),
                filters: [
                    {
                        name: $t('common.fileFilters.images'),
                        extensions: [...IMAGE_ASSET_EXTENSIONS]
                    }
                ]
            });
            if (!file || $activePersona?.id !== personaId) return;
            await updatePersonaAvatar(personaId, file);
        } catch (error) {
            toast.error({
                title: $t('persona.toast.updateAvatar'),
                description: getErrorMessage(error)
            });
        } finally {
            resourceAction = null;
        }
    }

    function openAssetGallery(ref: AssetRef): void {
        gallerySelectedId = ref.id;
        galleryOpen = true;
    }

    async function handleAvatarRemove() {
        if (!$activePersona?.avatar || resourceAction) return;
        const target = $activePersona;
        resourceAction = 'avatar-remove';
        try {
            const confirmed = await appConfirm({
                title: $t('persona.profile.removeAvatarTitle'),
                description: $t('persona.profile.removeAvatarBody', { name: target.name }),
                confirmText: $t('common.actions.remove'),
                variant: 'destructive'
            });
            if (!confirmed || $activePersona?.id !== target.id) return;
            await removePersonaAvatar(target.id);
        } catch (error) {
            toast.error({
                title: $t('persona.toast.removeAvatar'),
                description: getErrorMessage(error)
            });
        } finally {
            resourceAction = null;
        }
    }

    async function handleDelete() {
        if (!$activePersona || deleting) return;
        const target = $activePersona;
        deleting = true;
        try {
            const confirmed = await appConfirm({
                title: $t('persona.deleteTitle'),
                description: $t('persona.deleteBody', { name: target.name }),
                confirmText: $t('common.actions.delete'),
                variant: 'destructive'
            });
            if (!confirmed || $activePersona?.id !== target.id) return;
            await deletePersona(target.id);
            backToContext();
        } catch (error) {
            toast.error({
                title: $t('persona.toast.delete'),
                description: getErrorMessage(error)
            });
        } finally {
            deleting = false;
        }
    }

    async function handleExport(
        id: ExportButton,
        request:
            | { kind: 'risu'; format: 'png' }
            | { kind: 'keipersona'; assetMode: 'light' | 'baked' }
    ) {
        const persona = $activePersona;
        if (!persona || exporting) return;
        exporting = id;
        try {
            await runPorterOperation({ kind: 'export', entity: 'persona' }, (onProgress) =>
                exportPersonaFile(persona.id, request, onProgress)
            );
        } catch (error) {
            toast.error({
                title: $t('persona.toast.export'),
                description: getErrorMessage(error)
            });
        } finally {
            exporting = null;
        }
    }

    // Asset methods
    function startRename(ref: AssetRef) {
        editingId = ref.id;
        editName = ref.name;
    }

    function cancelRename() {
        editingId = null;
        editName = '';
    }

    async function saveRename(ref: AssetRef) {
        if (!$activePersona || resourceAction) return;
        const val = editName.trim();
        if (!val) return;
        if (val === ref.name) return cancelRename();

        const personaId = $activePersona.id;
        resourceAction = `asset-rename:${ref.id}`;
        try {
            await updatePersona(personaId, {
                assets: {
                    refs: { [ref.id]: { ...ref, name: val } }
                }
            });
            if ($activePersona?.id === personaId) cancelRename();
        } catch (error) {
            toast.error({
                title: $t('persona.toast.renameAsset'),
                description: getErrorMessage(error)
            });
        } finally {
            resourceAction = null;
        }
    }

    async function handleAssetFileSelect() {
        if (!$activePersona || resourceAction) return;
        const personaId = $activePersona.id;
        resourceAction = 'asset-upload';
        try {
            const files = await appDialog.openMultipleFiles({
                title: $t('persona.assets.uploadTitle'),
                filters: [
                    {
                        name: $t('common.fileFilters.media'),
                        extensions: [...MEDIA_ASSET_EXTENSIONS]
                    }
                ]
            });
            if (!files?.length || $activePersona?.id !== personaId) return;
            let uploadError: unknown;
            for (const file of files) {
                if ($activePersona?.id !== personaId) return;
                try {
                    await createPersonaAsset(personaId, file);
                } catch (error) {
                    uploadError ??= error;
                }
            }
            if (uploadError) throw uploadError;
        } catch (error) {
            toast.error({
                title: $t('persona.toast.uploadAsset'),
                description: getErrorMessage(error)
            });
        } finally {
            resourceAction = null;
        }
    }

    async function handleDeleteAsset(ref: AssetRef) {
        if (!$activePersona || resourceAction) return;
        const personaId = $activePersona.id;
        resourceAction = `asset-delete:${ref.id}`;
        try {
            const confirmed = await appConfirm({
                title: $t('persona.assets.deleteTitle'),
                description: $t('persona.assets.deleteBody', { name: ref.name }),
                confirmText: $t('common.actions.delete'),
                variant: 'destructive'
            });
            if (!confirmed || $activePersona?.id !== personaId) return;
            await deletePersonaAsset(personaId, ref.id);
        } catch (error) {
            toast.error({
                title: $t('persona.toast.deleteAsset'),
                description: getErrorMessage(error)
            });
        } finally {
            resourceAction = null;
        }
    }
</script>

{#snippet identityAvatar(sizeClass: string)}
    <div
        class="flex {sizeClass} shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted"
    >
        <MediaView
            asset={$activePersona?.avatar
                ? {
                      scopeType: $activePersona.scopeType,
                      scopeId: $activePersona.scopeId,
                      ownerTable: 'personas',
                      ownerId: $activePersona.id,
                      hash: $activePersona.avatar.hash,
                      encKey: $activePersona.avatar.encKey,
                      mimeType: $activePersona.avatar.mimeType
                  }
                : null}
            alt={$activePersona?.name ?? $t('persona.studio.avatarFallback')}
            class="size-full object-cover"
            fallback="none"
            focus="top"
        >
            {#if !$activePersona?.avatar}
                <UserRoundPen class="size-5 text-muted-foreground" />
            {/if}
        </MediaView>
    </div>
{/snippet}

<WorkspaceShell
    workspaceName={$t('persona.studio.title')}
    entityName={$activePersona?.name}
    sections={tabs}
    activeSection={activeTab}
    showDetail={personaTab !== undefined}
    onSelect={openTab}
    onBack={returnToTabs}
    onClose={backToContext}
    closeLabel={$t('persona.studio.close')}
    identity={identityAvatar}
>
    {#if !$activePersona}
        <div class="flex flex-1 items-center justify-center">
            <p class="text-muted-foreground">{$t('persona.studio.loading')}</p>
        </div>
    {:else}
        <ScrollArea class="min-h-0 flex-1">
            <div class="max-w-4xl p-4 md:px-8 md:pb-8 md:pt-4">
                {#if activeTab === 'profile'}
                    <div class="space-y-4">
                        <div class="flex items-center gap-4">
                            <div class="shrink-0">
                                {#if $activePersona.avatar}
                                    <button
                                        type="button"
                                        class="size-20 cursor-zoom-in overflow-hidden rounded-full border-2 border-primary/20 bg-muted transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                        aria-label={$t('persona.profile.viewNamedAvatar', {
                                            name: $activePersona.name
                                        })}
                                        title={$t('persona.profile.viewAvatar')}
                                        onclick={() => (avatarGalleryOpen = true)}
                                    >
                                        <MediaView
                                            asset={avatarGalleryItems[0]?.asset}
                                            alt={$activePersona.name}
                                            class="size-full object-cover"
                                            fallback="none"
                                            focus="top"
                                        />
                                    </button>
                                {:else}
                                    <div
                                        class="size-20 overflow-hidden rounded-full border-2 border-primary/20 bg-muted"
                                    >
                                        <MediaView
                                            asset={null}
                                            alt={$activePersona.name}
                                            class="size-full object-cover"
                                            fallback="none"
                                            focus="top"
                                        >
                                            <div class="flex size-full items-center justify-center">
                                                <UserRoundPen
                                                    class="size-10 text-muted-foreground/50"
                                                />
                                            </div>
                                        </MediaView>
                                    </div>
                                {/if}
                            </div>

                            <div class="min-w-0 flex-1 space-y-3">
                                <div class="grid gap-1.5">
                                    <Label>{$t('persona.profile.nameLabel')}</Label>
                                    <Input
                                        value={$activePersona.name}
                                        oninput={(e) =>
                                            updatePersona($activePersona!.id, {
                                                name: e.currentTarget.value
                                            })}
                                        placeholder={$t('persona.profile.namePlaceholder')}
                                    />
                                </div>
                                <div class="flex flex-wrap items-center gap-1">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        class="gap-1 px-2"
                                        disabled={resourceAction !== null}
                                        aria-busy={resourceAction === 'avatar-upload'}
                                        onclick={handleAvatarUpload}
                                    >
                                        <Upload class="size-4" />
                                        {$t('persona.profile.uploadAvatarButton')}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        class="gap-1 px-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                        disabled={!$activePersona.avatar || resourceAction !== null}
                                        aria-busy={resourceAction === 'avatar-remove'}
                                        onclick={handleAvatarRemove}
                                    >
                                        {$t('persona.profile.removeAvatarButton')}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div class="grid gap-1.5">
                            <Label for="persona-description"
                                >{$t('persona.profile.descriptionLabel')}</Label
                            >
                            <SyntaxTextarea
                                id="persona-description"
                                ariaLabel={$t('persona.profile.descriptionLabel')}
                                minRows={10}
                                language="markdown"
                                template
                                value={$activePersona.description}
                                oninput={(e) =>
                                    updatePersona($activePersona!.id, {
                                        description: e.currentTarget.value
                                    })}
                                placeholder={$t('persona.profile.descriptionPlaceholder')}
                            />
                        </div>
                    </div>
                {:else if activeTab === 'assets'}
                    <section class="space-y-4">
                        <div class="flex items-center justify-between">
                            <Label
                                class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                            >
                                {$t('persona.profile.assetsLabel')}
                            </Label>
                            <div class="flex items-center gap-2">
                                <Badge variant="outline" class="text-[10px] font-mono"
                                    >{assetRefs.length}</Badge
                                >
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    class="gap-1"
                                    disabled={resourceAction !== null}
                                    aria-busy={resourceAction === 'asset-upload'}
                                    onclick={handleAssetFileSelect}
                                >
                                    <Plus class="size-3" />
                                    {$t('persona.profile.addButton')}
                                </Button>
                            </div>
                        </div>

                        <EntityList
                            entities={assetRefs}
                            config={$activePersona.assets}
                            layout="list"
                            onCreateFolder={(name, parentId, sortOrder) =>
                                createPersonaFolder(
                                    $activePersona!.id,
                                    'assets',
                                    name,
                                    parentId,
                                    sortOrder
                                )}
                            onUpdateFolder={(id, changes) =>
                                updatePersonaFolder($activePersona!.id, 'assets', id, changes)}
                            onDeleteFolder={(id) =>
                                deletePersonaFolder($activePersona!.id, 'assets', id)}
                            onMoveItem={(itemId, newFolderId, newSortOrder) =>
                                movePersonaItem(
                                    $activePersona!.id,
                                    'assets',
                                    itemId,
                                    newFolderId,
                                    newSortOrder
                                )}
                            onItemClick={openAssetGallery}
                        >
                            {#snippet empty()}
                                <EmptyListPlaceholder message={$t('persona.assets.empty')} />
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
                                                scopeType: $activePersona!.scopeType,
                                                scopeId: $activePersona!.scopeId,
                                                ownerTable: 'personas',
                                                ownerId: $activePersona!.id,
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
                                                    disabled={resourceAction !== null}
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
                                            <span
                                                class="text-[10px] text-muted-foreground ml-2 font-mono"
                                                >{ref.mimeType}</span
                                            >
                                        {/if}
                                    </div>
                                    <div
                                        class={editingId === ref.id
                                            ? 'flex items-center gap-1'
                                            : 'touch-visible flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100'}
                                    >
                                        {#if editingId === ref.id}
                                            <Button
                                                size="icon-sm"
                                                title={$t('persona.assets.save')}
                                                aria-label={$t('persona.assets.saveNamed', {
                                                    name: ref.name
                                                })}
                                                disabled={resourceAction !== null ||
                                                    !editName.trim()}
                                                aria-busy={resourceAction ===
                                                    `asset-rename:${ref.id}`}
                                                onclick={() => saveRename(ref)}
                                            >
                                                <Check class="size-3.5" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                title={$t('common.actions.cancel')}
                                                aria-label={$t('persona.assets.cancelRename', {
                                                    name: ref.name
                                                })}
                                                disabled={resourceAction !== null}
                                                onclick={cancelRename}
                                            >
                                                <X class="size-3.5" />
                                            </Button>
                                        {:else}
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                class="text-muted-foreground hover:bg-muted hover:text-foreground"
                                                title={$t('persona.assets.rename')}
                                                aria-label={$t('persona.assets.renameNamed', {
                                                    name: ref.name
                                                })}
                                                disabled={resourceAction !== null}
                                                onclick={() => startRename(ref)}
                                            >
                                                <Pencil class="size-3.5" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                class="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                title={$t('common.actions.delete')}
                                                aria-label={$t('persona.assets.deleteNamed', {
                                                    name: ref.name
                                                })}
                                                disabled={resourceAction !== null}
                                                aria-busy={resourceAction ===
                                                    `asset-delete:${ref.id}`}
                                                onclick={() => handleDeleteAsset(ref)}
                                            >
                                                <Trash2 class="size-3.5" />
                                            </Button>
                                        {/if}
                                    </div>
                                </div>
                            {/snippet}
                        </EntityList>
                    </section>
                {:else if activeTab === 'advanced'}
                    <AdvancedTab
                        showLightExport={isKeiServer()}
                        {exporting}
                        {deleting}
                        onExportRisu={() =>
                            handleExport('risu', {
                                kind: 'risu',
                                format: 'png'
                            })}
                        onExportLight={() =>
                            handleExport('keipersona-light', {
                                kind: 'keipersona',
                                assetMode: 'light'
                            })}
                        onExportBaked={() =>
                            handleExport('keipersona-baked', {
                                kind: 'keipersona',
                                assetMode: 'baked'
                            })}
                        onDelete={handleDelete}
                    />
                {/if}
            </div>
        </ScrollArea>
    {/if}
</WorkspaceShell>

<AssetViewerDialog
    bind:open={galleryOpen}
    bind:selectedId={gallerySelectedId}
    items={galleryItems}
    title={$t('persona.assets.galleryTitle', {
        name: $activePersona?.name ?? $t('persona.studio.avatarFallback')
    })}
/>

<AssetViewerDialog
    bind:open={avatarGalleryOpen}
    items={avatarGalleryItems}
    title={$t('persona.profile.avatar')}
/>
