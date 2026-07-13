<script lang="ts">
    import {
        ChevronLeft,
        ChevronRight,
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
    import { isKeiServer } from '$lib/adapters/pb';
    import { exportPersonaFile } from '$lib/managers/persona';
    import type { AssetRef } from '$lib/types/refs';
    import { appDialog } from '$lib/adapters/dialog';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    let { personaId, personaTab }: { personaId: string; personaTab?: PersonaStudioTab } = $props();

    let activeTab = $state<PersonaStudioTab>('profile');
    let editingId = $state<string | null>(null);
    let editName = $state('');
    let deleting = $state(false);

    const tabs = [
        { id: 'profile' as const, label: 'Profile', icon: UserRound },
        { id: 'assets' as const, label: 'Assets', icon: ImageIcon },
        { id: 'advanced' as const, label: 'Advanced', icon: Settings2 }
    ];

    let hasSelectedTab = $derived(personaTab !== undefined);
    let activeTabLabel = $derived(
        tabs.find((tab) => tab.id === activeTab)?.label ?? 'Persona Studio'
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

    const assetRefs = $derived($activePersona ? Object.values($activePersona.assets.refs) : []);

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
        const file = await appDialog.openFile({
            title: 'Upload Persona Avatar',
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
        });
        if (!$activePersona || !file) return;
        await updatePersonaAvatar($activePersona.id, file);
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

    // Asset methods
    function startRename(ref: AssetRef) {
        editingId = ref.id;
        editName = ref.name;
    }

    async function saveRename(ref: AssetRef) {
        if (!$activePersona) return;
        const val = editName.trim();
        if (val && val !== ref.name) {
            await updatePersona($activePersona.id, {
                assets: {
                    refs: { [ref.id]: { ...ref, name: val } }
                }
            });
        }
        editingId = null;
    }

    async function handleAssetFileSelect() {
        const file = await appDialog.openFile({
            title: 'Upload Persona Asset',
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
        });
        if (!$activePersona || !file) return;
        await createPersonaAsset($activePersona.id, file);
    }

    async function handleDeleteAsset(assetId: string) {
        if (!$activePersona) return;
        await deletePersonaAsset($activePersona.id, assetId);
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
                      encKey: $activePersona.avatar.encKey
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

<div class="flex h-full min-h-0 flex-col bg-background">
    <div class="flex min-h-0 flex-1 overflow-hidden">
        <nav
            class="min-h-0 w-full shrink-0 flex-col border-r bg-muted/30 md:flex md:min-w-64 md:w-[max(16rem,calc((100vw-72rem)/2+16rem))] {hasSelectedTab
                ? 'hidden'
                : 'flex'}"
            aria-label="Persona Studio sections"
        >
            <div class="flex h-14 shrink-0 items-center border-b px-2 md:hidden">
                {@render identityAvatar('size-8')}
                <div class="min-w-0 flex-1 px-2">
                    <p class="truncate text-sm font-semibold">
                        {$activePersona?.name ?? 'Persona'}
                    </p>
                    <p class="text-[11px] text-muted-foreground">Persona Studio</p>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    onclick={backToContext}
                    aria-label="Close studio"
                >
                    <X class="size-5" />
                </Button>
            </div>
            <div
                class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-4 md:ml-auto md:w-64 md:flex-none md:px-4 md:pb-4 md:pt-8"
            >
                {#if $activePersona}
                    <div class="mb-4 hidden items-center gap-3 px-3 md:flex">
                        {@render identityAvatar('size-10')}
                        <div class="min-w-0">
                            <p class="truncate text-sm font-medium">{$activePersona.name}</p>
                            <p class="text-xs text-muted-foreground">Persona Studio</p>
                        </div>
                    </div>
                {/if}
                {#each tabs as tab (tab.id)}
                    <button
                        class="flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors md:min-h-0 {activeTab ===
                        tab.id
                            ? hasSelectedTab
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground md:bg-primary md:text-primary-foreground md:shadow-sm'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
                        onclick={() => openTab(tab.id)}
                        aria-current={activeTab === tab.id ? 'page' : undefined}
                    >
                        <tab.icon class="size-4" />
                        <span>{tab.label}</span>
                        <ChevronRight class="ml-auto size-4 md:hidden" />
                    </button>
                {/each}
            </div>
        </nav>

        <main
            class="min-h-0 flex-1 flex-col overflow-hidden md:flex {hasSelectedTab
                ? 'flex'
                : 'hidden'}"
        >
            <div
                class="flex h-14 w-full max-w-4xl shrink-0 items-center border-b px-2 md:mt-4 md:border-b-0 md:px-8"
            >
                <Button
                    variant="ghost"
                    size="icon"
                    class="md:hidden"
                    onclick={returnToTabs}
                    aria-label="Back to Persona Studio sections"
                >
                    <ChevronLeft class="size-5" />
                </Button>
                <div class="md:hidden">{@render identityAvatar('size-8')}</div>
                <div class="min-w-0 flex-1 px-2 md:px-0">
                    <p class="truncate text-sm font-semibold md:text-xl">{activeTabLabel}</p>
                    {#if $activePersona}
                        <p class="hidden truncate text-xs text-muted-foreground md:block">
                            {$activePersona.name}
                        </p>
                    {/if}
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    onclick={backToContext}
                    aria-label="Close studio"
                >
                    <X class="size-5" />
                </Button>
            </div>
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
                                        <div class="flex items-center gap-6">
                                            <div class="group relative">
                                                <div
                                                    class="size-24 overflow-hidden rounded-full border-2 border-primary/20 bg-muted"
                                                >
                                                    <AssetView
                                                        asset={$activePersona.avatar
                                                            ? {
                                                                  scopeType:
                                                                      $activePersona.scopeType,
                                                                  scopeId: $activePersona.scopeId,
                                                                  ownerTable: 'personas',
                                                                  ownerId: $activePersona.id,
                                                                  hash: $activePersona.avatar.hash,
                                                                  encKey: $activePersona.avatar
                                                                      .encKey
                                                              }
                                                            : null}
                                                        alt={$activePersona.name}
                                                        class="size-full object-cover"
                                                        fallback="none"
                                                    >
                                                        {#if !$activePersona.avatar}
                                                            <div
                                                                class="flex size-full items-center justify-center"
                                                            >
                                                                <User
                                                                    class="size-10 text-muted-foreground/50"
                                                                />
                                                            </div>
                                                        {/if}
                                                    </AssetView>
                                                </div>
                                                <button
                                                    class="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100"
                                                    onclick={handleAvatarUpload}
                                                    title="Upload avatar"
                                                >
                                                    <Upload class="size-6" />
                                                </button>
                                            </div>

                                            <div class="flex-1 space-y-4">
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
                                                <div class="flex items-center gap-2">
                                                    <Button
                                                        variant="destructive"
                                                        size="sm"
                                                        disabled={!$activePersona.avatar}
                                                        onclick={() =>
                                                            removePersonaAvatar($activePersona!.id)}
                                                    >
                                                        Remove Avatar
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
                                                Used for persona prompt blocks and chat participant
                                                context.
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
                                        updatePersonaFolder(
                                            $activePersona!.id,
                                            'assets',
                                            id,
                                            changes
                                        )}
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
                                >
                                    {#snippet empty()}
                                        <EmptyListPlaceholder
                                            message="No assets. Use Add to upload an image or file."
                                        />
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
                                                        scopeType: $activePersona!.scopeType,
                                                        scopeId: $activePersona!.scopeId,
                                                        ownerTable: 'personas',
                                                        ownerId: $activePersona!.id,
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
                                                    <span
                                                        class="text-[10px] text-muted-foreground ml-2 font-mono"
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
                                                    onclick={() => handleDeleteAsset(ref.id)}
                                                >
                                                    <Trash2 class="size-3" />
                                                </Button>
                                            </div>
                                        </div>
                                    {/snippet}
                                </EntityList>
                            </section>
                        {:else if activeTab === 'advanced'}
                            <AdvancedTab
                                showLightExport={isKeiServer()}
                                {deleting}
                                onExportRisu={() =>
                                    exportPersonaFile($activePersona!.id, {
                                        kind: 'risu',
                                        format: 'png'
                                    })}
                                onExportLight={() =>
                                    exportPersonaFile($activePersona!.id, {
                                        kind: 'keipersona',
                                        assetMode: 'light'
                                    })}
                                onExportBaked={() =>
                                    exportPersonaFile($activePersona!.id, {
                                        kind: 'keipersona',
                                        assetMode: 'baked'
                                    })}
                                onDelete={handleDelete}
                            />
                        {/if}
                    </div>
                </ScrollArea>
            {/if}
        </main>
    </div>
</div>
