<script lang="ts">
    import {
        Check,
        Image as ImageIcon,
        Settings2,
        Pencil,
        Plus,
        Trash2,
        Upload,
        User,
        UserRound,
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
    import { Textarea } from '$lib/components/ui/textarea';
    import AssetView from '$lib/components/AssetView.svelte';
    import MediaGalleryDialog from '$lib/components/MediaGalleryDialog.svelte';
    import type { MediaGalleryItem } from '$lib/components/MediaGalleryDialog.svelte';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import AdvancedTab from './AdvancedTab.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import {
        activeChat,
        activePersona,
        activeRoom,
        deletePersona,
        removePersonaAvatar,
        updatePersona,
        updatePersonaAvatar,
        createPersonaAsset,
        deletePersonaAsset,
        createPersonaFolder,
        updatePersonaFolder,
        deletePersonaFolder,
        movePersonaItem
    } from '$lib/stores';
    import { navigate, type PersonaStudioTab } from '$lib/router';
    import { isKeiServer } from '$lib/services';
    import { exportPersonaFile } from '$lib/managers/persona';
    import type { AssetRef } from '$lib/types/refs';
    import { IMAGE_ASSET_EXTENSIONS, MEDIA_ASSET_EXTENSIONS } from '$lib/types/asset';
    import { appDialog } from '$lib/adapters/dialog';
    import { appConfirm, toast } from '$lib/ui';
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

    const tabs = [
        { id: 'profile' as const, label: 'Profile', icon: UserRound },
        { id: 'assets' as const, label: 'Assets', icon: ImageIcon },
        { id: 'advanced' as const, label: 'Advanced', icon: Settings2 }
    ];

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
    const galleryItems = $derived.by<MediaGalleryItem[]>(() => {
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
    const avatarGalleryItems = $derived.by<MediaGalleryItem[]>(() => {
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
                title: 'Upload Persona Avatar',
                filters: [{ name: 'Images', extensions: [...IMAGE_ASSET_EXTENSIONS] }]
            });
            if (!file || $activePersona?.id !== personaId) return;
            await updatePersonaAvatar(personaId, file);
        } catch (error) {
            toast.error({ title: 'Could not update avatar', description: getErrorMessage(error) });
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
                title: 'Remove persona avatar?',
                description: `Remove the avatar for "${target.name}"?`,
                confirmText: 'Remove',
                variant: 'destructive'
            });
            if (!confirmed || $activePersona?.id !== target.id) return;
            await removePersonaAvatar(target.id);
        } catch (error) {
            toast.error({ title: 'Could not remove avatar', description: getErrorMessage(error) });
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
                title: 'Delete persona?',
                description: `Delete "${target.name}" and its owned assets? This cannot be undone.`,
                confirmText: 'Delete',
                variant: 'destructive'
            });
            if (!confirmed || $activePersona?.id !== target.id) return;
            await deletePersona(target.id);
            backToContext();
        } catch (error) {
            toast.error({ title: 'Could not delete persona', description: getErrorMessage(error) });
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
        if (!$activePersona || exporting) return;
        const targetId = $activePersona.id;
        exporting = id;
        try {
            await exportPersonaFile(targetId, request);
        } catch (error) {
            toast.error({ title: 'Could not export persona', description: getErrorMessage(error) });
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
            toast.error({ title: 'Could not rename asset', description: getErrorMessage(error) });
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
                title: 'Upload Persona Asset',
                filters: [
                    {
                        name: 'Images, audio, and video',
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
            toast.error({ title: 'Could not upload asset', description: getErrorMessage(error) });
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
                title: 'Delete persona asset?',
                description: `Delete "${ref.name}"?`,
                confirmText: 'Delete',
                variant: 'destructive'
            });
            if (!confirmed || $activePersona?.id !== personaId) return;
            await deletePersonaAsset(personaId, ref.id);
        } catch (error) {
            toast.error({ title: 'Could not delete asset', description: getErrorMessage(error) });
        } finally {
            resourceAction = null;
        }
    }
</script>

{#snippet identityAvatar(sizeClass: string)}
    <div
        class="flex {sizeClass} shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted"
    >
        <AssetView
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
            alt={$activePersona?.name ?? 'Persona'}
            class="size-full object-cover"
            fallback="none"
        >
            {#if !$activePersona?.avatar}
                <UserRound class="size-5 text-muted-foreground" />
            {/if}
        </AssetView>
    </div>
{/snippet}

<WorkspaceShell
    workspaceName="Persona Studio"
    entityName={$activePersona?.name}
    sections={tabs}
    activeSection={activeTab}
    showDetail={personaTab !== undefined}
    onSelect={openTab}
    onBack={returnToTabs}
    onClose={backToContext}
    closeLabel="Close studio"
    identity={identityAvatar}
>
    {#if !$activePersona}
        <div class="flex flex-1 items-center justify-center">
            <p class="text-muted-foreground">Loading persona data...</p>
        </div>
    {:else}
        <ScrollArea class="min-h-0 flex-1">
            <div class="max-w-4xl p-4 md:px-8 md:pb-8 md:pt-4">
                {#if activeTab === 'profile'}
                    <section class="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Basic Information</CardTitle>
                                <CardDescription>
                                    How this persona appears in chats and prompt context.
                                </CardDescription>
                            </CardHeader>
                            <CardContent class="space-y-6">
                                <div class="flex items-center gap-4 sm:gap-6">
                                    <div class="shrink-0">
                                        {#if $activePersona.avatar}
                                            <button
                                                type="button"
                                                class="size-20 cursor-zoom-in overflow-hidden rounded-full border-2 border-primary/20 bg-muted transition hover:border-primary/50 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:size-24"
                                                aria-label={`View ${$activePersona.name} avatar`}
                                                title="View avatar"
                                                onclick={() => (avatarGalleryOpen = true)}
                                            >
                                                <AssetView
                                                    asset={avatarGalleryItems[0]?.asset}
                                                    alt={$activePersona.name}
                                                    class="size-full object-cover"
                                                    fallback="none"
                                                />
                                            </button>
                                        {:else}
                                            <div
                                                class="size-20 overflow-hidden rounded-full border-2 border-primary/20 bg-muted sm:size-24"
                                            >
                                                <AssetView
                                                    asset={null}
                                                    alt={$activePersona.name}
                                                    class="size-full object-cover"
                                                    fallback="none"
                                                >
                                                    <div
                                                        class="flex size-full items-center justify-center"
                                                    >
                                                        <User
                                                            class="size-10 text-muted-foreground/50"
                                                        />
                                                    </div>
                                                </AssetView>
                                            </div>
                                        {/if}
                                    </div>

                                    <div class="min-w-0 flex-1 space-y-4">
                                        <div class="grid gap-1.5">
                                            <Label>Persona Name</Label>
                                            <Input
                                                value={$activePersona.name}
                                                oninput={(e) =>
                                                    updatePersona($activePersona!.id, {
                                                        name: e.currentTarget.value
                                                    })}
                                                placeholder="Enter persona name..."
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
                                                <Upload class="size-4" /> Upload avatar
                                            </Button>
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                class="gap-1 px-2"
                                                disabled={!$activePersona.avatar ||
                                                    resourceAction !== null}
                                                aria-busy={resourceAction === 'avatar-remove'}
                                                onclick={handleAvatarRemove}
                                            >
                                                Remove avatar
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                <div class="grid gap-1.5">
                                    <Label>Persona Description</Label>
                                    <Textarea
                                        rows={5}
                                        value={$activePersona.description}
                                        oninput={(e) =>
                                            updatePersona($activePersona!.id, {
                                                description: e.currentTarget.value
                                            })}
                                        placeholder="Describe how this persona should speak, act, or be represented..."
                                    />
                                    <p class="text-xs text-muted-foreground">
                                        Used for persona prompt blocks and chat participant context.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </section>
                {:else if activeTab === 'assets'}
                    <section class="space-y-4">
                        <div class="flex items-center justify-between">
                            <Label
                                class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                            >
                                Assets
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
                                    <Plus class="size-3" /> Add
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
                                <EmptyListPlaceholder
                                    message="No assets. Upload an image, audio, or video file."
                                />
                            {/snippet}
                            {#snippet item({ entity: ref })}
                                <div
                                    class="group flex cursor-zoom-in items-center gap-3 rounded-md border bg-background p-2 transition-colors hover:bg-muted/50"
                                >
                                    <div
                                        class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted"
                                    >
                                        <AssetView
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
                                            : 'touch-visible flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100'}
                                    >
                                        {#if editingId === ref.id}
                                            <Button
                                                size="icon-sm"
                                                class="size-7"
                                                title="Save"
                                                aria-label={`Save ${ref.name} name`}
                                                disabled={resourceAction !== null ||
                                                    !editName.trim()}
                                                aria-busy={resourceAction ===
                                                    `asset-rename:${ref.id}`}
                                                onclick={() => saveRename(ref)}
                                            >
                                                <Check class="size-3" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                class="size-7"
                                                title="Cancel"
                                                aria-label={`Cancel renaming ${ref.name}`}
                                                disabled={resourceAction !== null}
                                                onclick={cancelRename}
                                            >
                                                <X class="size-3" />
                                            </Button>
                                        {:else}
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                class="size-7"
                                                title="Rename"
                                                aria-label={`Rename ${ref.name}`}
                                                disabled={resourceAction !== null}
                                                onclick={() => startRename(ref)}
                                            >
                                                <Pencil class="size-3" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                class="size-7 text-destructive hover:text-destructive"
                                                title="Delete"
                                                aria-label={`Delete ${ref.name}`}
                                                disabled={resourceAction !== null}
                                                aria-busy={resourceAction ===
                                                    `asset-delete:${ref.id}`}
                                                onclick={() => handleDeleteAsset(ref)}
                                            >
                                                <Trash2 class="size-3" />
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

<MediaGalleryDialog
    bind:open={galleryOpen}
    bind:selectedId={gallerySelectedId}
    items={galleryItems}
    title={`${$activePersona?.name ?? 'Persona'} assets`}
/>

<MediaGalleryDialog
    bind:open={avatarGalleryOpen}
    items={avatarGalleryItems}
    title="Persona avatar"
/>
