<script lang="ts">
    import { onDestroy, type Snippet } from 'svelte';
    import {
        DoorOpen,
        Package,
        Plus,
        Search,
        Upload,
        UserRound,
        UserRoundPen,
        Zap
    } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import RoomAvatar from '$lib/components/RoomAvatar.svelte';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import MediaEntityCard from '$lib/components/entitylist/MediaEntityCard.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import {
        activeChat,
        activeRoom,
        appSettings,
        characters,
        createCharacter,
        createGlobalFolder,
        createModule,
        createPersona,
        createRoom,
        deleteGlobalFolder,
        modules,
        moveGlobalItem,
        personas,
        rooms,
        selectRoom,
        setModuleEnabled,
        t,
        updateGlobalFolder
    } from '$lib/stores';
    import { libraryTab, runPorterOperation, toast } from '$lib/ui';
    import {
        importCharacterFile,
        navigateToCharacterStudio,
        navigateToModuleStudio,
        navigateToPersonaStudio
    } from '$lib/managers';
    import { importModuleFile } from '$lib/managers/module';
    import { importPersonaFile } from '$lib/managers/persona';
    import { isKeiServer } from '$lib/services';
    import type { RouteState } from '$lib/router';
    import { getErrorMessage } from '$lib/types/errors';
    import type { FolderDef } from '$lib/types/refs';

    interface Props {
        onNavigate: (route: RouteState) => void;
    }

    interface LibraryFolderPayload {
        folder: FolderDef;
        collapsed: boolean;
        toggle: () => void;
        childCount: number;
        parts: {
            icon: Snippet<[{ folder: FolderDef; collapsed: boolean; sizeClass?: string }]>;
            name: Snippet<[{ folder: FolderDef }]>;
            actions: Snippet<[{ folder: FolderDef }]>;
        };
    }

    let { onNavigate }: Props = $props();

    type LibraryTab = 'rooms' | 'characters' | 'personas' | 'modules';

    let query = $state('');
    let homeAction = $state<string | null>(null);
    let destroyed = false;

    const libraryEntityLayout = 'grid' as const;
    const centeredLibraryGridClass =
        'grid w-full grid-cols-[repeat(auto-fit,10rem)] justify-center gap-2';

    const filteredRooms = $derived(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return $rooms;
        return $rooms.filter((room) => room.name.toLowerCase().includes(normalized));
    });

    const filteredCharacters = $derived(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return $characters;
        return $characters.filter((character) => character.name.toLowerCase().includes(normalized));
    });

    const filteredPersonas = $derived(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return $personas;
        return $personas.filter((persona) => persona.name.toLowerCase().includes(normalized));
    });

    const filteredModules = $derived(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return $modules;
        return $modules.filter((mod) => mod.name.toLowerCase().includes(normalized));
    });

    onDestroy(() => {
        destroyed = true;
    });

    function selectLibraryTab(nextTab: LibraryTab): void {
        $libraryTab = nextTab;
    }

    async function runHomeAction(
        key: string,
        errorTitle: string,
        action: () => void | Promise<unknown>
    ): Promise<boolean> {
        if (homeAction) return false;
        homeAction = key;
        try {
            await action();
            return true;
        } catch (error) {
            toast.error({ title: errorTitle, description: getErrorMessage(error) });
            return false;
        } finally {
            homeAction = null;
        }
    }

    async function prepareAndNavigateRoom(roomId: string): Promise<void> {
        await selectRoom(roomId);
        if (destroyed || $activeRoom?.id !== roomId) return;
        onNavigate({ view: 'room', roomId, chatId: $activeChat?.id });
    }

    async function openRoom(roomId: string): Promise<void> {
        await runHomeAction(`open-room:${roomId}`, $t('library.toast.openRoom'), () =>
            prepareAndNavigateRoom(roomId)
        );
    }

    async function handleCreateRoom() {
        await runHomeAction('create-room', $t('library.toast.createRoom'), async () => {
            const room = await createRoom();
            await prepareAndNavigateRoom(room.id);
        });
    }

    async function handleCreateCharacter() {
        await runHomeAction('create-character', $t('library.toast.createCharacter'), async () => {
            const character = await createCharacter();
            if (!destroyed) await navigateToCharacterStudio(character.id);
        });
    }

    async function handleCreateModule() {
        await runHomeAction('create-module', $t('library.toast.createModule'), async () => {
            const mod = await createModule();
            if (!destroyed) await navigateToModuleStudio(mod.id);
        });
    }

    async function handleCreatePersona() {
        await runHomeAction('create-persona', $t('library.toast.createPersona'), async () => {
            const persona = await createPersona();
            if (!destroyed) await navigateToPersonaStudio(persona.id);
        });
    }

    async function handleSetModuleEnabled(moduleId: string, enabled: boolean) {
        await runHomeAction(`toggle-module:${moduleId}`, $t('library.toast.updateModule'), () =>
            setModuleEnabled(moduleId, enabled)
        );
    }

    async function handleImportModule() {
        await runHomeAction('import-module', $t('library.toast.importModule'), async () => {
            const mod = await runPorterOperation(
                { kind: 'import', entity: 'module' },
                (onProgress) =>
                    importModuleFile({
                        allowLightAssets: isKeiServer(),
                        select: true,
                        onProgress
                    })
            );
            if (mod && !destroyed) await navigateToModuleStudio(mod.id);
        });
    }

    async function handleImportCharacter() {
        await runHomeAction('import-character', $t('library.toast.importCharacter'), async () => {
            const character = await runPorterOperation(
                { kind: 'import', entity: 'character' },
                (onProgress) =>
                    importCharacterFile({
                        allowLightAssets: isKeiServer(),
                        select: true,
                        onProgress
                    })
            );
            if (character && !destroyed) {
                await navigateToCharacterStudio(character.id);
            }
        });
    }

    async function handleImportPersona() {
        await runHomeAction('import-persona', $t('library.toast.importPersona'), async () => {
            const persona = await runPorterOperation(
                { kind: 'import', entity: 'persona' },
                (onProgress) =>
                    importPersonaFile({
                        allowLightAssets: isKeiServer(),
                        select: true,
                        onProgress
                    })
            );
            if (persona && !destroyed) await navigateToPersonaStudio(persona.id);
        });
    }

    const searchPlaceholder = $derived(
        $libraryTab === 'rooms'
            ? $t('library.search.rooms')
            : $libraryTab === 'characters'
              ? $t('library.search.characters')
              : $libraryTab === 'modules'
                ? $t('library.search.modules')
                : $t('library.search.personas')
    );

    const libraryTabDescription = $derived(
        $libraryTab === 'characters'
            ? $t('library.tabDescription.characters')
            : $libraryTab === 'modules'
              ? $t('library.tabDescription.modules')
              : $libraryTab === 'personas'
                ? $t('library.tabDescription.personas')
                : $t('library.tabDescription.rooms')
    );

    const libraryCreateLabel = $derived(
        $libraryTab === 'rooms'
            ? $t('library.create.room')
            : $libraryTab === 'characters'
              ? $t('library.create.character')
              : $libraryTab === 'modules'
                ? $t('library.create.module')
                : $t('library.create.persona')
    );

    function libraryCreateAction(): string {
        if ($libraryTab === 'rooms') return 'create-room';
        if ($libraryTab === 'characters') return 'create-character';
        if ($libraryTab === 'modules') return 'create-module';
        return 'create-persona';
    }

    function handleLibraryCreate(): void {
        if ($libraryTab === 'rooms') void handleCreateRoom();
        else if ($libraryTab === 'characters') void handleCreateCharacter();
        else if ($libraryTab === 'modules') void handleCreateModule();
        else if ($libraryTab === 'personas') void handleCreatePersona();
    }

    function handleLibraryImport(): void {
        if ($libraryTab === 'characters') void handleImportCharacter();
        else if ($libraryTab === 'modules') void handleImportModule();
        else if ($libraryTab === 'personas') void handleImportPersona();
    }

    function initial(nameValue: string): string {
        return (nameValue.trim().charAt(0) || '?').toUpperCase();
    }

    function libraryLayoutClass(gridClass: string, _listClass: string): string {
        return gridClass;
    }

    function centeredLibraryItemWrapperClass(): string {
        return 'relative w-full drop-target';
    }
</script>

{#snippet libraryFolder(payload: LibraryFolderPayload)}
    {@const { folder, collapsed, toggle, childCount, parts } = payload}
    <div
        role="button"
        tabindex="0"
        aria-expanded={!collapsed}
        aria-label={folder.name}
        class="group/folder relative w-full cursor-pointer select-none"
        onclick={toggle}
        onkeydown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            toggle();
        }}
    >
        <MediaEntityCard
            name={folder.name}
            meta={$t('common.counts.items', { count: childCount })}
            class="cursor-pointer"
        >
            {#snippet visual()}
                {@render parts.icon({
                    folder,
                    collapsed,
                    sizeClass: 'size-14 rounded-xl [&_svg]:size-6'
                })}
            {/snippet}
            {#snippet nameContent()}
                {@render parts.name({ folder })}
            {/snippet}
            {#snippet action()}
                {@render parts.actions({ folder })}
            {/snippet}
        </MediaEntityCard>
    </div>
{/snippet}

<div class="flex h-full flex-col overflow-hidden bg-background" aria-busy={homeAction !== null}>
    <header class="shrink-0 border-b px-4 py-4 sm:px-6 md:px-8 md:py-5">
        <div class="mx-auto max-w-5xl text-center">
            <h1 class="text-2xl font-semibold tracking-tight md:text-3xl">
                {$t('library.title')}
            </h1>
        </div>
    </header>

    <main class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 md:px-8 md:pt-4 md:pb-8">
        <div class="mx-auto max-w-5xl space-y-6">
            <div class="flex flex-col gap-4 md:gap-3">
                <nav
                    class="mx-auto grid w-full max-w-xl grid-cols-4 gap-2"
                    aria-label={$t('library.categories')}
                >
                    <button
                        class="group flex min-w-0 flex-col items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all md:py-2 {$libraryTab ===
                        'rooms'
                            ? 'border-border bg-card text-foreground shadow-sm'
                            : 'border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/40 hover:text-foreground'}"
                        aria-current={$libraryTab === 'rooms' ? 'page' : undefined}
                        onclick={() => selectLibraryTab('rooms')}
                    >
                        <span
                            class="flex size-7 items-center justify-center rounded-md transition-colors md:size-8 {$libraryTab ===
                            'rooms'
                                ? 'bg-foreground text-background'
                                : 'bg-muted text-muted-foreground group-hover:text-foreground'}"
                        >
                            <DoorOpen class="size-4" aria-hidden="true" />
                        </span>
                        <span class="truncate">{$t('library.tabs.rooms')}</span>
                    </button>
                    <button
                        class="group flex min-w-0 flex-col items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all md:py-2 {$libraryTab ===
                        'characters'
                            ? 'border-border bg-card text-foreground shadow-sm'
                            : 'border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/40 hover:text-foreground'}"
                        aria-current={$libraryTab === 'characters' ? 'page' : undefined}
                        onclick={() => selectLibraryTab('characters')}
                    >
                        <span
                            class="flex size-7 items-center justify-center rounded-md transition-colors md:size-8 {$libraryTab ===
                            'characters'
                                ? 'bg-foreground text-background'
                                : 'bg-muted text-muted-foreground group-hover:text-foreground'}"
                        >
                            <UserRound class="size-4" aria-hidden="true" />
                        </span>
                        <span class="truncate">{$t('library.tabs.characters')}</span>
                    </button>
                    <button
                        class="group flex min-w-0 flex-col items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all md:py-2 {$libraryTab ===
                        'personas'
                            ? 'border-border bg-card text-foreground shadow-sm'
                            : 'border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/40 hover:text-foreground'}"
                        aria-current={$libraryTab === 'personas' ? 'page' : undefined}
                        onclick={() => selectLibraryTab('personas')}
                    >
                        <span
                            class="flex size-7 items-center justify-center rounded-md transition-colors md:size-8 {$libraryTab ===
                            'personas'
                                ? 'bg-foreground text-background'
                                : 'bg-muted text-muted-foreground group-hover:text-foreground'}"
                        >
                            <UserRoundPen class="size-4" aria-hidden="true" />
                        </span>
                        <span class="truncate">{$t('library.tabs.personas')}</span>
                    </button>
                    <button
                        class="group flex min-w-0 flex-col items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all md:py-2 {$libraryTab ===
                        'modules'
                            ? 'border-border bg-card text-foreground shadow-sm'
                            : 'border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/40 hover:text-foreground'}"
                        aria-current={$libraryTab === 'modules' ? 'page' : undefined}
                        onclick={() => selectLibraryTab('modules')}
                    >
                        <span
                            class="flex size-7 items-center justify-center rounded-md transition-colors md:size-8 {$libraryTab ===
                            'modules'
                                ? 'bg-foreground text-background'
                                : 'bg-muted text-muted-foreground group-hover:text-foreground'}"
                        >
                            <Package class="size-4" aria-hidden="true" />
                        </span>
                        <span class="truncate">{$t('library.tabs.modules')}</span>
                    </button>
                </nav>
                <p class="text-center text-sm text-muted-foreground">
                    {libraryTabDescription}
                </p>

                <div class="mx-auto flex w-full max-w-3xl items-center gap-2">
                    <div class="relative min-w-0 flex-1">
                        <Search
                            class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input bind:value={query} placeholder={searchPlaceholder} class="pl-9" />
                    </div>

                    {#if $libraryTab !== 'rooms'}
                        <Button
                            variant="outline"
                            class="shrink-0 gap-2 px-3"
                            disabled={homeAction !== null}
                            aria-label={$t('library.import.title', { tab: $libraryTab })}
                            title={$t('library.import.title', { tab: $libraryTab })}
                            aria-busy={homeAction === `import-${$libraryTab.slice(0, -1)}`}
                            onclick={handleLibraryImport}
                        >
                            <Upload class="size-4" />
                            <span class="hidden sm:inline">{$t('library.import.button')}</span>
                        </Button>
                    {/if}
                    <Button
                        class="shrink-0 gap-2 px-3"
                        disabled={homeAction !== null}
                        aria-label={libraryCreateLabel}
                        title={libraryCreateLabel}
                        aria-busy={homeAction === libraryCreateAction()}
                        onclick={handleLibraryCreate}
                    >
                        <Plus class="size-4" />
                        <span class="hidden sm:inline">{libraryCreateLabel}</span>
                    </Button>
                </div>
            </div>

            {#if $appSettings}
                {#if $libraryTab === 'rooms'}
                    <EntityList
                        entities={filteredRooms()}
                        config={$appSettings.rooms}
                        layout={libraryEntityLayout}
                        gridClass={centeredLibraryGridClass}
                        itemWrapperClass={centeredLibraryItemWrapperClass}
                        gridOverlapInset={0.18}
                        folderWrapperClass={centeredLibraryItemWrapperClass}
                        folder={libraryFolder}
                        childContainerClass={libraryLayoutClass(
                            'relative ml-6 p-3 my-1',
                            'relative ml-3 my-1 px-2 py-1.5'
                        )}
                        onItemClick={(room) => openRoom(room.id)}
                        onCreateFolder={(name, parentId, sortOrder) =>
                            createGlobalFolder('rooms', name, parentId, sortOrder)}
                        onUpdateFolder={(id, changes) => updateGlobalFolder('rooms', id, changes)}
                        onDeleteFolder={(id) => deleteGlobalFolder('rooms', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveGlobalItem('rooms', itemId, newFolderId, newSortOrder)}
                    >
                        {#snippet empty()}
                            <div class="flex h-[50vh] items-center justify-center">
                                <div class="max-w-sm text-center">
                                    <div
                                        class="mx-auto flex size-14 items-center justify-center rounded-full bg-muted"
                                    >
                                        <DoorOpen class="size-6 text-muted-foreground" />
                                    </div>
                                    <h2 class="mt-4 text-lg font-semibold">
                                        {$t('library.empty.roomsTitle')}
                                    </h2>
                                    <p class="mt-2 text-sm text-muted-foreground">
                                        {$t('library.empty.roomsBody')}
                                    </p>
                                    <Button
                                        class="mt-5 gap-2"
                                        disabled={homeAction !== null}
                                        aria-busy={homeAction === 'create-room'}
                                        onclick={handleCreateRoom}
                                    >
                                        <Plus class="size-4" />
                                        {$t('library.create.room')}
                                    </Button>
                                </div>
                            </div>
                        {/snippet}
                        {#snippet item({ entity: room })}
                            {@const characterCount = Object.keys(room.characters.refs).length}
                            {@const chatCount = Object.keys(room.chats.refs).length}
                            <MediaEntityCard
                                name={room.name}
                                meta={$t('library.meta.room', {
                                    characters: characterCount,
                                    chats: chatCount
                                })}
                                class="cursor-pointer"
                            >
                                {#snippet visual()}
                                    <RoomAvatar {room} class="size-full" />
                                {/snippet}
                            </MediaEntityCard>
                        {/snippet}
                    </EntityList>
                {:else if $libraryTab === 'characters'}
                    <EntityList
                        entities={filteredCharacters()}
                        config={$appSettings.characters}
                        layout={libraryEntityLayout}
                        gridClass={centeredLibraryGridClass}
                        itemWrapperClass={centeredLibraryItemWrapperClass}
                        gridOverlapInset={0.18}
                        folderWrapperClass={centeredLibraryItemWrapperClass}
                        folder={libraryFolder}
                        childContainerClass={libraryLayoutClass(
                            'relative ml-6 p-3 my-1',
                            'relative ml-3 my-1 px-2 py-1.5'
                        )}
                        onItemClick={(character) => navigateToCharacterStudio(character.id)}
                        onCreateFolder={(name, parentId, sortOrder) =>
                            createGlobalFolder('characters', name, parentId, sortOrder)}
                        onUpdateFolder={(id, changes) =>
                            updateGlobalFolder('characters', id, changes)}
                        onDeleteFolder={(id) => deleteGlobalFolder('characters', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveGlobalItem('characters', itemId, newFolderId, newSortOrder)}
                    >
                        {#snippet empty()}
                            <div class="flex h-[50vh] items-center justify-center">
                                <div class="max-w-sm text-center">
                                    <div
                                        class="mx-auto flex size-14 items-center justify-center rounded-full bg-muted"
                                    >
                                        <UserRound class="size-6 text-muted-foreground" />
                                    </div>
                                    <h2 class="mt-4 text-lg font-semibold">
                                        {$t('library.empty.charactersTitle')}
                                    </h2>
                                    <p class="mt-2 text-sm text-muted-foreground">
                                        {$t('library.empty.charactersBody')}
                                    </p>
                                    <Button
                                        class="mt-5 gap-2"
                                        disabled={homeAction !== null}
                                        aria-busy={homeAction === 'create-character'}
                                        onclick={handleCreateCharacter}
                                    >
                                        <Plus class="size-4" />
                                        {$t('library.create.character')}
                                    </Button>
                                </div>
                            </div>
                        {/snippet}
                        {#snippet item({ entity: character })}
                            <MediaEntityCard
                                name={character.name}
                                meta={character.description || $t('common.noDescription')}
                                class="cursor-pointer"
                                visualClass="text-xl font-semibold"
                            >
                                {#snippet visual()}
                                    {#if character.avatar}
                                        <AssetView
                                            asset={{
                                                scopeType: character.scopeType,
                                                scopeId: character.scopeId,
                                                ownerTable: 'characters',
                                                ownerId: character.id,
                                                hash: character.avatar.hash,
                                                encKey: character.avatar.encKey,
                                                mimeType: character.avatar.mimeType
                                            }}
                                            alt={character.name}
                                            class="size-full object-cover"
                                            focus="top"
                                        />
                                    {:else}
                                        {initial(character.name)}
                                    {/if}
                                {/snippet}
                            </MediaEntityCard>
                        {/snippet}
                    </EntityList>
                {:else if $libraryTab === 'modules'}
                    <EntityList
                        entities={filteredModules()}
                        config={$appSettings.modules}
                        layout={libraryEntityLayout}
                        gridClass={centeredLibraryGridClass}
                        itemWrapperClass={centeredLibraryItemWrapperClass}
                        gridOverlapInset={0.18}
                        folderWrapperClass={centeredLibraryItemWrapperClass}
                        folder={libraryFolder}
                        childContainerClass={libraryLayoutClass(
                            'relative ml-6 p-3 my-1',
                            'relative ml-3 my-1 px-2 py-1.5'
                        )}
                        onItemClick={(mod) => navigateToModuleStudio(mod.id)}
                        onCreateFolder={(name, parentId, sortOrder) =>
                            createGlobalFolder('modules', name, parentId, sortOrder)}
                        onUpdateFolder={(id, changes) => updateGlobalFolder('modules', id, changes)}
                        onDeleteFolder={(id) => deleteGlobalFolder('modules', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveGlobalItem('modules', itemId, newFolderId, newSortOrder)}
                    >
                        {#snippet empty()}
                            <div class="flex h-[50vh] items-center justify-center">
                                <div class="max-w-sm text-center">
                                    <div
                                        class="mx-auto flex size-14 items-center justify-center rounded-full bg-muted"
                                    >
                                        <Package class="size-6 text-muted-foreground" />
                                    </div>
                                    <h2 class="mt-4 text-lg font-semibold">
                                        {$t('library.empty.modulesTitle')}
                                    </h2>
                                    <p class="mt-2 text-sm text-muted-foreground">
                                        {$t('library.empty.modulesBody')}
                                    </p>
                                    <Button
                                        class="mt-5 gap-2"
                                        disabled={homeAction !== null}
                                        aria-busy={homeAction === 'create-module'}
                                        onclick={handleCreateModule}
                                    >
                                        <Plus class="size-4" />
                                        {$t('library.create.module')}
                                    </Button>
                                </div>
                            </div>
                        {/snippet}
                        {#snippet item({ entity: mod })}
                            {@const enabled = $appSettings.modules.refs[mod.id]?.enabled ?? true}
                            <MediaEntityCard
                                name={mod.name}
                                meta={mod.description || $t('common.noDescription')}
                                class="cursor-pointer {enabled ? '' : 'opacity-60'}"
                            >
                                {#snippet visual()}
                                    <Package class="size-14" aria-hidden="true" />
                                {/snippet}
                                {#snippet action()}
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        class="size-7 rounded-full border border-border/60 bg-background/85 shadow-sm backdrop-blur-sm transition-colors hover:bg-background {enabled
                                            ? 'text-amber-500 hover:text-amber-600'
                                            : 'text-muted-foreground hover:text-foreground'}"
                                        title={enabled
                                            ? $t('library.module.deactivate')
                                            : $t('library.module.activate')}
                                        aria-label={enabled
                                            ? $t('library.module.deactivate')
                                            : $t('library.module.activate')}
                                        disabled={homeAction !== null}
                                        aria-busy={homeAction === `toggle-module:${mod.id}`}
                                        onclick={(event) => {
                                            event.stopPropagation();
                                            void handleSetModuleEnabled(mod.id, !enabled);
                                        }}
                                    >
                                        <Zap class="size-4 {enabled ? 'fill-amber-500/10' : ''}" />
                                    </Button>
                                {/snippet}
                            </MediaEntityCard>
                        {/snippet}
                    </EntityList>
                {:else if $libraryTab === 'personas'}
                    <EntityList
                        entities={filteredPersonas()}
                        config={$appSettings.personas}
                        layout={libraryEntityLayout}
                        gridClass={centeredLibraryGridClass}
                        itemWrapperClass={centeredLibraryItemWrapperClass}
                        gridOverlapInset={0.18}
                        folderWrapperClass={centeredLibraryItemWrapperClass}
                        folder={libraryFolder}
                        childContainerClass={libraryLayoutClass(
                            'relative ml-6 p-3 my-1',
                            'relative ml-3 my-1 px-2 py-1.5'
                        )}
                        onItemClick={(persona) => navigateToPersonaStudio(persona.id)}
                        onCreateFolder={(name, parentId, sortOrder) =>
                            createGlobalFolder('personas', name, parentId, sortOrder)}
                        onUpdateFolder={(id, changes) =>
                            updateGlobalFolder('personas', id, changes)}
                        onDeleteFolder={(id) => deleteGlobalFolder('personas', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveGlobalItem('personas', itemId, newFolderId, newSortOrder)}
                    >
                        {#snippet empty()}
                            <div class="flex h-[50vh] items-center justify-center">
                                <div class="max-w-sm text-center">
                                    <div
                                        class="mx-auto flex size-14 items-center justify-center rounded-full bg-muted"
                                    >
                                        <UserRoundPen class="size-6 text-muted-foreground" />
                                    </div>
                                    <h2 class="mt-4 text-lg font-semibold">
                                        {$t('library.empty.personasTitle')}
                                    </h2>
                                    <p class="mt-2 text-sm text-muted-foreground">
                                        {$t('library.empty.personasBody')}
                                    </p>
                                    <Button
                                        class="mt-5 gap-2"
                                        disabled={homeAction !== null}
                                        aria-busy={homeAction === 'create-persona'}
                                        onclick={handleCreatePersona}
                                    >
                                        <Plus class="size-4" />
                                        {$t('library.create.persona')}
                                    </Button>
                                </div>
                            </div>
                        {/snippet}
                        {#snippet item({ entity: persona })}
                            <MediaEntityCard
                                name={persona.name}
                                meta={persona.description || $t('common.noDescription')}
                                class="cursor-pointer"
                                visualClass="text-xl font-semibold"
                            >
                                {#snippet visual()}
                                    {#if persona.avatar}
                                        <AssetView
                                            asset={{
                                                scopeType: persona.scopeType,
                                                scopeId: persona.scopeId,
                                                ownerTable: 'personas',
                                                ownerId: persona.id,
                                                hash: persona.avatar.hash,
                                                encKey: persona.avatar.encKey,
                                                mimeType: persona.avatar.mimeType
                                            }}
                                            alt={persona.name}
                                            class="size-full object-cover"
                                            focus="top"
                                        />
                                    {:else}
                                        {initial(persona.name)}
                                    {/if}
                                {/snippet}
                            </MediaEntityCard>
                        {/snippet}
                    </EntityList>
                {/if}
            {/if}
        </div>
    </main>
</div>
