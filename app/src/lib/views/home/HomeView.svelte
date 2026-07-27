<script lang="ts">
    import {
        DoorOpen,
        Globe2,
        KeyRound,
        Lock,
        Package,
        Plus,
        Search,
        Settings2,
        Sparkles,
        Trash2,
        Upload,
        UserRound,
        Users,
        Zap
    } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import RoomAvatar from '$lib/components/RoomAvatar.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import {
        activeChat,
        activeRoom,
        appSettings,
        characters,
        createCharacter,
        createGlobalFolder,
        createMultiRoom,
        createPersona,
        createRoom,
        deleteCharacter,
        deleteGlobalFolder,
        deleteMultiRoom,
        deletePersona,
        deleteRoom,
        leaveMultiRoom,
        loadOwnedMultiRoomMembers,
        loadMultiRoomMembers,
        moveGlobalItem,
        modules,
        multiRoomMembers,
        multiRoomMetas,
        multiRooms,
        personas,
        rejectJoinMultiRoom,
        revokeMultiRoomMember,
        setModuleEnabled,
        createModule,
        deleteModule,
        rooms,
        selectMultiRoom,
        selectRoom,
        updateMultiRoomIndex,
        updateGlobalFolder,
        userId
    } from '$lib/stores';
    import { appAlert, appConfirm, libraryTab, toast } from '$lib/ui';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
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
    import { MultiRoomService } from '$lib/services';
    import { formatPublicKeyFingerprint } from '$lib/crypto';
    import { getErrorMessage } from '$lib/types/errors';
    import { approveMultiRoomJoinRequest } from '$lib/stores';
    import MultiRoomManageDialog from './MultiRoomManageDialog.svelte';
    import JoinMultiRoomDialog from './JoinMultiRoomDialog.svelte';
    import { onDestroy } from 'svelte';

    interface Props {
        space?: 'library' | 'multiRooms';
        onNavigate: (route: RouteState) => void;
    }

    let { space = 'library', onNavigate }: Props = $props();

    type LibraryTab = 'rooms' | 'characters' | 'personas' | 'modules';
    type Tab = LibraryTab | 'multiRooms';
    let tab = $derived<Tab>(space === 'multiRooms' ? 'multiRooms' : $libraryTab);
    let query = $state('');
    let creatingMultiRoom = $state(false);
    let homeAction = $state<string | null>(null);
    let multiRoomName = $state('');
    let multiRoomVisibility = $state<'private' | 'public'>('private');
    let multiRoomActionError = $state('');
    let joinDialogOpen = $state(false);
    let approvingMemberId = $state('');
    let managedRoomId = $state<string | null>(null);
    let manageDialogOpen = $state(false);
    let viewportWidth = $state(1024);
    let destroyed = false;
    const libraryEntityLayout = $derived(viewportWidth < 768 ? 'list' : 'grid');

    const filteredRooms = $derived(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return $rooms;
        return $rooms.filter((room) => room.name.toLowerCase().includes(normalized));
    });

    const filteredMultiRooms = $derived(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return $multiRooms;
        return $multiRooms.filter((room) => room.name.toLowerCase().includes(normalized));
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

    const managedRoom = $derived(
        managedRoomId ? ($multiRooms.find((room) => room.id === managedRoomId) ?? null) : null
    );
    const managedRoomMeta = $derived(
        managedRoomId ? ($multiRoomMetas.find((meta) => meta.id === managedRoomId) ?? null) : null
    );
    const managedRoomMembers = $derived(
        managedRoomId ? ($multiRoomMembers.get(managedRoomId) ?? []) : []
    );
    const busyManagedMemberId = $derived(approvingMemberId.split(':')[1] ?? null);

    onDestroy(() => {
        destroyed = true;
    });

    function selectLibraryTab(nextTab: LibraryTab): void {
        $libraryTab = nextTab;
    }

    $effect(() => {
        if (tab === 'multiRooms') {
            void loadOwnedMultiRoomMembers();
        }
    });

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

    async function runConfirmedHomeAction(
        key: string,
        errorTitle: string,
        title: string,
        description: string,
        action: () => void | Promise<unknown>,
        confirmText = 'Delete'
    ): Promise<boolean> {
        let confirmed = false;
        const completed = await runHomeAction(key, errorTitle, async () => {
            confirmed = await appConfirm({
                title,
                description,
                confirmText,
                variant: 'destructive'
            });
            if (confirmed) await action();
        });
        return completed && confirmed;
    }

    async function handleCreateRoom() {
        await runHomeAction('create-room', 'Could not create room', async () => {
            const room = await createRoom();
            await prepareAndNavigateRoom(room.id);
        });
    }

    async function handleCreateMultiRoom() {
        const trimmed = multiRoomName.trim();
        if (!trimmed) return;

        const room = await createMultiRoom({
            name: trimmed,
            publicName: multiRoomVisibility === 'public' ? trimmed : undefined,
            visibility: multiRoomVisibility
        });
        multiRoomName = '';
        multiRoomVisibility = 'private';
        creatingMultiRoom = false;
        await openMultiRoom(room.id);
    }

    async function handleApprovePending(roomId: string, memberUserId: string) {
        approvingMemberId = `${roomId}:${memberUserId}`;
        multiRoomActionError = '';
        try {
            const user = await MultiRoomService.getUserPublicKey(memberUserId);
            const fingerprint = await MultiRoomService.fingerprintUserPublicKey(user);
            const trusted = await MultiRoomService.getUserKeyTrust(user.userId);
            const formatted = formatPublicKeyFingerprint(fingerprint);
            const userLabel = user.username ? `@${user.username}` : user.userId;

            if (!trusted) {
                const ok = await appConfirm({
                    title: 'Trust member key?',
                    description: `First time seeing ${userLabel}.\n\nFingerprint\n${formatted}`,
                    confirmText: 'Trust',
                    variant: 'destructive'
                });
                if (!ok) return;
                await MultiRoomService.trustUserPublicKey(user, fingerprint);
            } else if (trusted.publicKeyFingerprint !== fingerprint) {
                await appAlert({
                    title: 'Public key changed',
                    description: `Public key fingerprint changed for ${userLabel}.\n\nPrevious\n${formatPublicKeyFingerprint(trusted.publicKeyFingerprint)}\n\nCurrent\n${formatted}`
                });
                return;
            } else {
                await MultiRoomService.trustUserPublicKey(user, fingerprint);
            }

            const publicKey = await MultiRoomService.importUserPublicKey(user);
            await approveMultiRoomJoinRequest(roomId, user.userId, publicKey);
            await loadOwnedMultiRoomMembers();
        } catch (e) {
            multiRoomActionError = getErrorMessage(e);
        } finally {
            approvingMemberId = '';
        }
    }

    async function handleRejectPending(roomId: string, memberUserId: string) {
        approvingMemberId = `${roomId}:${memberUserId}`;
        multiRoomActionError = '';
        try {
            await rejectJoinMultiRoom(roomId, memberUserId);
            await loadOwnedMultiRoomMembers();
        } catch (e) {
            multiRoomActionError = getErrorMessage(e);
        } finally {
            approvingMemberId = '';
        }
    }

    async function handleOpenMultiRoomManagement(roomId: string) {
        multiRoomActionError = '';
        try {
            await loadMultiRoomMembers(roomId);
            managedRoomId = roomId;
            manageDialogOpen = true;
        } catch (e) {
            multiRoomActionError = getErrorMessage(e);
        }
    }

    async function handleManagedVisibility(visibility: 'private' | 'public') {
        if (!managedRoomId || !managedRoom) return;
        const roomId = managedRoomId;
        const roomName = managedRoom.name;
        await runHomeAction('manage-visibility', 'Could not change room visibility', () =>
            updateMultiRoomIndex(roomId, {
                visibility,
                publicName: visibility === 'public' ? roomName : undefined
            })
        );
    }

    async function handleRevokeMember(roomId: string, memberUserId: string) {
        if (approvingMemberId) return;
        approvingMemberId = `${roomId}:${memberUserId}`;
        try {
            await runHomeAction(
                `revoke-member:${memberUserId}`,
                'Could not remove member',
                async () => {
                    const confirmed = await appConfirm({
                        title: 'Remove member?',
                        description: `Remove member ${memberUserId} from this room?`,
                        confirmText: 'Remove',
                        variant: 'destructive'
                    });
                    if (confirmed) await revokeMultiRoomMember(roomId, memberUserId);
                }
            );
        } finally {
            approvingMemberId = '';
        }
    }

    async function openMultiRoom(roomId: string) {
        await selectMultiRoom(roomId);
        onNavigate({ view: 'room', roomId });
    }

    async function prepareAndNavigateRoom(roomId: string): Promise<void> {
        await selectRoom(roomId);
        if (destroyed || $activeRoom?.id !== roomId) return;
        onNavigate({ view: 'room', roomId, chatId: $activeChat?.id });
    }

    async function openRoom(roomId: string): Promise<void> {
        await runHomeAction(`open-room:${roomId}`, 'Could not open room', () =>
            prepareAndNavigateRoom(roomId)
        );
    }

    async function handleCreateCharacter() {
        await runHomeAction('create-character', 'Could not create character', async () => {
            const character = await createCharacter();
            if (!destroyed) await navigateToCharacterStudio(character.id);
        });
    }

    async function handleCreateModule() {
        await runHomeAction('create-module', 'Could not create module', async () => {
            const mod = await createModule();
            if (!destroyed) await navigateToModuleStudio(mod.id);
        });
    }

    async function handleSetModuleEnabled(moduleId: string, enabled: boolean) {
        await runHomeAction(`toggle-module:${moduleId}`, 'Could not update module', () =>
            setModuleEnabled(moduleId, enabled)
        );
    }

    async function handleImportModule() {
        await runHomeAction('import-module', 'Could not import module', async () => {
            const mod = await importModuleFile({
                allowLightAssets: isKeiServer(),
                select: true
            });
            if (mod && !destroyed) await navigateToModuleStudio(mod.id);
        });
    }

    async function handleImportCharacter() {
        await runHomeAction('import-character', 'Could not import character', async () => {
            const character = await importCharacterFile({
                allowLightAssets: isKeiServer(),
                select: true
            });
            if (character && !destroyed) {
                await navigateToCharacterStudio(character.id);
            }
        });
    }

    async function handleDeleteCharacter(characterId: string, name: string) {
        await runConfirmedHomeAction(
            `delete-character:${characterId}`,
            'Could not delete character',
            'Delete character?',
            `Delete character "${name}"?`,
            () => deleteCharacter(characterId)
        );
    }

    async function handleDeleteRoom(roomId: string, name: string) {
        await runConfirmedHomeAction(
            `delete-room:${roomId}`,
            'Could not delete room',
            'Delete room?',
            `Delete room "${name}"?`,
            () => deleteRoom(roomId)
        );
    }

    async function handleDeleteMultiRoom(roomId: string, name: string): Promise<boolean> {
        return runConfirmedHomeAction(
            `delete-multi-room:${roomId}`,
            'Could not delete multi room',
            'Delete multi room?',
            `Delete multi room "${name}"?`,
            () => deleteMultiRoom(roomId)
        );
    }

    async function handleLeaveMultiRoom(roomId: string, name: string): Promise<boolean> {
        return runConfirmedHomeAction(
            `leave-multi-room:${roomId}`,
            'Could not leave multi room',
            'Leave multi room?',
            `Leave multi room "${name}"?`,
            () => leaveMultiRoom(roomId),
            'Leave'
        );
    }

    async function handleImportPersona() {
        await runHomeAction('import-persona', 'Could not import persona', async () => {
            const persona = await importPersonaFile({
                allowLightAssets: isKeiServer(),
                select: true
            });
            if (persona && !destroyed) await navigateToPersonaStudio(persona.id);
        });
    }

    async function handleDeletePersona(personaId: string, name: string) {
        await runConfirmedHomeAction(
            `delete-persona:${personaId}`,
            'Could not delete persona',
            'Delete persona?',
            `Delete persona "${name}"?`,
            () => deletePersona(personaId)
        );
    }

    async function handleDeleteModule(moduleId: string, name: string) {
        await runConfirmedHomeAction(
            `delete-module:${moduleId}`,
            'Could not delete module',
            'Delete module?',
            `Delete module "${name}"?`,
            () => deleteModule(moduleId)
        );
    }

    async function handleCreatePersona() {
        await runHomeAction('create-persona', 'Could not create persona', async () => {
            const persona = await createPersona();
            if (!destroyed) await navigateToPersonaStudio(persona.id);
        });
    }

    function searchPlaceholder(): string {
        if (tab === 'rooms') return 'Search rooms...';
        if (tab === 'multiRooms') return 'Search multi rooms...';
        if (tab === 'characters') return 'Search characters...';
        if (tab === 'modules') return 'Search modules...';
        return 'Search personas...';
    }

    function initial(nameValue: string): string {
        return (nameValue.trim().charAt(0) || '?').toUpperCase();
    }
</script>

<svelte:window bind:innerWidth={viewportWidth} />

<div class="flex h-full flex-col overflow-hidden bg-background" aria-busy={homeAction !== null}>
    <header class="shrink-0 border-b px-4 py-4 sm:px-6 md:px-8 md:py-6">
        <div class="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
            <div class="min-w-0 pl-12 lg:pl-0">
                <h1 class="text-xl font-semibold">
                    {space === 'multiRooms' ? 'Multi Rooms' : 'Library'}
                </h1>
                <p class="mt-1 text-sm text-muted-foreground">
                    {tab === 'multiRooms'
                        ? 'Create and join encrypted shared rooms.'
                        : tab === 'characters'
                          ? 'Reusable speakers for every room.'
                          : tab === 'modules'
                            ? 'Reusable context and automation bundles.'
                            : tab === 'personas'
                              ? 'Your identities across conversations.'
                              : 'Spaces for characters and conversations.'}
                </p>
            </div>
            {#if tab === 'rooms'}
                <Button
                    class="w-full gap-2 sm:w-auto"
                    disabled={homeAction !== null}
                    aria-busy={homeAction === 'create-room'}
                    onclick={handleCreateRoom}
                >
                    <Plus class="size-4" /> New Room
                </Button>
            {:else if tab === 'multiRooms'}
                {#if creatingMultiRoom}
                    <form
                        class="flex w-full flex-col items-stretch justify-end gap-2 sm:max-w-xl sm:flex-row sm:items-center"
                        onsubmit={(event) => {
                            event.preventDefault();
                            handleCreateMultiRoom();
                        }}
                    >
                        <Input
                            bind:value={multiRoomName}
                            class="w-full sm:max-w-xs"
                            placeholder="Multi room name..."
                            autofocus
                        />
                        <div
                            class="flex shrink-0 rounded-md border bg-muted/30 p-1 max-sm:[&>*]:flex-1"
                        >
                            <Button
                                type="button"
                                size="sm"
                                variant={multiRoomVisibility === 'private' ? 'secondary' : 'ghost'}
                                class="h-7 gap-1.5 px-2.5 text-xs"
                                onclick={() => (multiRoomVisibility = 'private')}
                            >
                                <Lock class="size-3.5" /> Private
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant={multiRoomVisibility === 'public' ? 'secondary' : 'ghost'}
                                class="h-7 gap-1.5 px-2.5 text-xs"
                                onclick={() => (multiRoomVisibility = 'public')}
                            >
                                <Globe2 class="size-3.5" /> Public
                            </Button>
                        </div>
                        <Button type="submit">Create</Button>
                    </form>
                {:else}
                    <div class="flex w-full gap-2 sm:w-auto max-sm:[&>*]:flex-1">
                        <Button
                            variant="outline"
                            class="gap-2"
                            onclick={() => (joinDialogOpen = true)}
                        >
                            <KeyRound class="size-4" />
                            Join Room
                        </Button>
                        <Button class="gap-2" onclick={() => (creatingMultiRoom = true)}>
                            <Plus class="size-4" />
                            New Multi Room
                        </Button>
                    </div>
                {/if}
            {:else if tab === 'characters'}
                <div class="flex w-full gap-2 sm:w-auto max-sm:[&>*]:flex-1">
                    <Button
                        variant="outline"
                        class="gap-2"
                        disabled={homeAction !== null}
                        aria-busy={homeAction === 'import-character'}
                        onclick={handleImportCharacter}
                    >
                        <Upload class="size-4" /> Import
                    </Button>
                    <Button
                        class="gap-2"
                        disabled={homeAction !== null}
                        aria-busy={homeAction === 'create-character'}
                        onclick={handleCreateCharacter}
                    >
                        <Plus class="size-4" /> New Character
                    </Button>
                </div>
            {:else if tab === 'modules'}
                <div class="flex w-full gap-2 sm:w-auto max-sm:[&>*]:flex-1">
                    <Button
                        variant="outline"
                        class="gap-2"
                        disabled={homeAction !== null}
                        aria-busy={homeAction === 'import-module'}
                        onclick={handleImportModule}
                    >
                        <Upload class="size-4" />
                        Import
                    </Button>
                    <Button
                        class="gap-2"
                        disabled={homeAction !== null}
                        aria-busy={homeAction === 'create-module'}
                        onclick={handleCreateModule}
                    >
                        <Plus class="size-4" /> New Module
                    </Button>
                </div>
            {:else}
                <div class="flex w-full gap-2 sm:w-auto max-sm:[&>*]:flex-1">
                    <Button
                        variant="outline"
                        class="gap-2"
                        disabled={homeAction !== null}
                        aria-busy={homeAction === 'import-persona'}
                        onclick={handleImportPersona}
                    >
                        <Upload class="size-4" />
                        Import
                    </Button>
                    <Button
                        class="gap-2"
                        disabled={homeAction !== null}
                        aria-busy={homeAction === 'create-persona'}
                        onclick={handleCreatePersona}
                    >
                        <Plus class="size-4" /> New Persona
                    </Button>
                </div>
            {/if}
        </div>
    </header>

    <main class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 md:px-8 md:py-8">
        <div class="mx-auto max-w-6xl space-y-6">
            <div class="flex flex-wrap items-center justify-between gap-4">
                {#if space === 'library'}
                    <div class="flex w-full rounded-md border bg-muted/30 p-1 md:w-auto">
                        <button
                            class="min-w-0 flex-1 rounded px-2 py-1.5 text-sm font-medium transition-colors md:flex-none md:px-3 {tab ===
                            'rooms'
                                ? 'bg-background shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'}"
                            onclick={() => selectLibraryTab('rooms')}
                        >
                            Rooms
                        </button>
                        <button
                            class="min-w-0 flex-1 rounded px-2 py-1.5 text-sm font-medium transition-colors md:flex-none md:px-3 {tab ===
                            'characters'
                                ? 'bg-background shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'}"
                            onclick={() => selectLibraryTab('characters')}
                        >
                            Characters
                        </button>
                        <button
                            class="min-w-0 flex-1 rounded px-2 py-1.5 text-sm font-medium transition-colors md:flex-none md:px-3 {tab ===
                            'personas'
                                ? 'bg-background shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'}"
                            onclick={() => selectLibraryTab('personas')}
                        >
                            Personas
                        </button>
                        <button
                            class="min-w-0 flex-1 rounded px-2 py-1.5 text-sm font-medium transition-colors md:flex-none md:px-3 {tab ===
                            'modules'
                                ? 'bg-background shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'}"
                            onclick={() => selectLibraryTab('modules')}
                        >
                            Modules
                        </button>
                    </div>
                {:else}
                    <div class="flex items-center gap-2 text-sm text-muted-foreground">
                        <Users class="size-4" />
                        <span>Your encrypted shared spaces</span>
                        <span
                            class="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground"
                        >
                            {$multiRooms.length}
                        </span>
                    </div>
                {/if}

                <div class="relative w-full max-w-md">
                    <Search
                        class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input bind:value={query} placeholder={searchPlaceholder()} class="pl-9" />
                </div>
            </div>

            {#if $appSettings}
                {#if tab === 'rooms'}
                    <EntityList
                        entities={filteredRooms()}
                        config={$appSettings.rooms}
                        layout={libraryEntityLayout}
                        childContainerClass="relative ml-6 p-3 my-1"
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
                                        Create your first room
                                    </h2>
                                    <p class="mt-2 text-sm text-muted-foreground">
                                        Rooms hold character refs, chats, and conversation context.
                                    </p>
                                    <Button
                                        class="mt-5 gap-2"
                                        disabled={homeAction !== null}
                                        aria-busy={homeAction === 'create-room'}
                                        onclick={handleCreateRoom}
                                    >
                                        <Plus class="size-4" />
                                        New Room
                                    </Button>
                                </div>
                            </div>
                        {/snippet}
                        {#snippet item({ entity: room })}
                            {@const characterCount = Object.keys(room.characters.refs).length}
                            {@const chatCount = Object.keys(room.chats.refs).length}
                            <div
                                class="flex w-full min-h-32 flex-col items-start rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50 group"
                            >
                                <div class="flex w-full items-center gap-3">
                                    <div class="flex min-w-0 flex-1 items-center gap-3 text-left">
                                        <RoomAvatar {room} class="size-12 shrink-0" />
                                        <div class="min-w-0">
                                            <h2
                                                class="truncate text-sm font-semibold text-foreground"
                                            >
                                                {room.name}
                                            </h2>
                                            <p
                                                class="mt-0.5 truncate text-xs text-muted-foreground"
                                            >
                                                {characterCount} characters / {chatCount} chats
                                            </p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        class="shrink-0 text-muted-foreground hover:text-destructive"
                                        title="Delete room"
                                        aria-label={`Delete ${room.name}`}
                                        disabled={homeAction !== null}
                                        aria-busy={homeAction === `delete-room:${room.id}`}
                                        onclick={() => handleDeleteRoom(room.id, room.name)}
                                    >
                                        <Trash2 class="size-4" />
                                    </Button>
                                </div>
                                <div
                                    class="mt-auto flex items-center gap-1 pt-5 text-xs text-muted-foreground"
                                >
                                    <DoorOpen class="size-3.5" />
                                    Open room
                                </div>
                            </div>
                        {/snippet}
                    </EntityList>
                {:else if tab === 'multiRooms'}
                    {#if multiRoomActionError}
                        <div
                            class="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
                        >
                            {multiRoomActionError}
                        </div>
                    {/if}

                    <EntityList
                        entities={filteredMultiRooms()}
                        config={$appSettings.multiRooms}
                        layout={libraryEntityLayout}
                        childContainerClass="relative ml-6 p-3 my-1"
                        onItemClick={(room) => openMultiRoom(room.id)}
                        onCreateFolder={(name, parentId, sortOrder) =>
                            createGlobalFolder('multiRooms', name, parentId, sortOrder)}
                        onUpdateFolder={(id, changes) =>
                            updateGlobalFolder('multiRooms', id, changes)}
                        onDeleteFolder={(id) => deleteGlobalFolder('multiRooms', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveGlobalItem('multiRooms', itemId, newFolderId, newSortOrder)}
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
                                        Create your first multi room
                                    </h2>
                                    <p class="mt-2 text-sm text-muted-foreground">
                                        Multi rooms are shared spaces with room-scoped content.
                                    </p>
                                    <div
                                        class="mt-5 flex flex-col justify-center gap-2 sm:flex-row"
                                    >
                                        <Button
                                            variant="outline"
                                            class="gap-2"
                                            onclick={() => (joinDialogOpen = true)}
                                        >
                                            <KeyRound class="size-4" /> Join Room
                                        </Button>
                                        <Button
                                            class="gap-2"
                                            onclick={() => (creatingMultiRoom = true)}
                                        >
                                            <Plus class="size-4" /> New Multi Room
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        {/snippet}
                        {#snippet item({ entity: room })}
                            {@const characterCount = Object.keys(room.characters.refs).length}
                            {@const chatCount = Object.keys(room.chats.refs).length}
                            {@const meta = $multiRoomMetas.find((item) => item.id === room.id)}
                            {@const memberCount = ($multiRoomMembers.get(room.id) ?? []).filter(
                                (member) => member.status === 'accepted'
                            ).length}
                            {@const pendingCount =
                                meta?.ownerUserId === $userId
                                    ? ($multiRoomMembers.get(room.id) ?? []).filter(
                                          (member) => member.status === 'pending'
                                      ).length
                                    : 0}
                            <div
                                class="flex min-h-40 w-full flex-col items-start rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50"
                            >
                                <div class="flex w-full items-center gap-3">
                                    <div class="flex min-w-0 flex-1 items-center gap-3 text-left">
                                        <div
                                            role="img"
                                            class="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                                            title={meta?.visibility === 'public'
                                                ? 'Public multi room'
                                                : 'Private multi room'}
                                            aria-label={meta?.visibility === 'public'
                                                ? 'Public multi room'
                                                : 'Private multi room'}
                                        >
                                            {#if meta?.visibility === 'public'}
                                                <Globe2 class="size-5" />
                                            {:else}
                                                <Lock class="size-5" />
                                            {/if}
                                        </div>
                                        <div class="min-w-0">
                                            <h2 class="truncate text-sm font-semibold">
                                                {room.name}
                                            </h2>
                                            <p
                                                class="mt-0.5 truncate text-xs text-muted-foreground"
                                            >
                                                {characterCount} characters / {chatCount} chats
                                            </p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        class="shrink-0 text-muted-foreground hover:text-foreground"
                                        title="Manage multi room"
                                        aria-label={`Manage ${room.name}`}
                                        onclick={() => handleOpenMultiRoomManagement(room.id)}
                                    >
                                        <Settings2 class="size-4" />
                                    </Button>
                                </div>
                                <div class="mt-auto w-full space-y-3 pt-4 text-xs">
                                    <div
                                        class="flex w-full items-center gap-1.5 text-muted-foreground"
                                    >
                                        <span class="flex min-w-0 items-center gap-1.5">
                                            <span class="whitespace-nowrap">
                                                {memberCount} members
                                            </span>
                                            {#if pendingCount > 0}
                                                <span
                                                    class="whitespace-nowrap rounded-full bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-700 dark:text-amber-300"
                                                >
                                                    {pendingCount} pending
                                                </span>
                                            {/if}
                                        </span>
                                    </div>
                                    <span class="flex items-center gap-1 text-muted-foreground">
                                        <DoorOpen class="size-3.5" /> Open multi room
                                    </span>
                                </div>
                            </div>
                        {/snippet}
                    </EntityList>
                {:else if tab === 'characters'}
                    <EntityList
                        entities={filteredCharacters()}
                        config={$appSettings.characters}
                        layout={libraryEntityLayout}
                        childContainerClass="relative ml-6 p-3 my-1"
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
                                        <Sparkles class="size-6 text-muted-foreground" />
                                    </div>
                                    <h2 class="mt-4 text-lg font-semibold">
                                        Create your first character
                                    </h2>
                                    <p class="mt-2 text-sm text-muted-foreground">
                                        Characters are global resources you can add to rooms.
                                    </p>
                                    <Button
                                        class="mt-5 gap-2"
                                        disabled={homeAction !== null}
                                        aria-busy={homeAction === 'create-character'}
                                        onclick={handleCreateCharacter}
                                    >
                                        <Plus class="size-4" />
                                        New Character
                                    </Button>
                                </div>
                            </div>
                        {/snippet}
                        {#snippet item({ entity: character })}
                            <div
                                class="flex w-full min-h-32 flex-col items-start rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50"
                            >
                                <div class="flex w-full items-center gap-3">
                                    <div class="flex min-w-0 flex-1 items-center gap-3 text-left">
                                        <div
                                            class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-sm font-semibold"
                                        >
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
                                                />
                                            {:else}
                                                {initial(character.name)}
                                            {/if}
                                        </div>
                                        <div class="min-w-0">
                                            <h2 class="truncate text-sm font-semibold">
                                                {character.name}
                                            </h2>
                                            <p
                                                class="mt-0.5 truncate text-xs text-muted-foreground"
                                            >
                                                {character.description || 'No description'}
                                            </p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        class="shrink-0 text-muted-foreground hover:text-destructive"
                                        title="Delete character"
                                        aria-label={`Delete ${character.name}`}
                                        disabled={homeAction !== null}
                                        aria-busy={homeAction ===
                                            `delete-character:${character.id}`}
                                        onclick={() =>
                                            handleDeleteCharacter(character.id, character.name)}
                                    >
                                        <Trash2 class="size-4" />
                                    </Button>
                                </div>
                                <div
                                    class="mt-auto flex items-center gap-1 pt-5 text-xs text-muted-foreground"
                                >
                                    <UserRound class="size-3.5" />
                                    Open studio
                                </div>
                            </div>
                        {/snippet}
                    </EntityList>
                {:else if tab === 'modules'}
                    <EntityList
                        entities={filteredModules()}
                        config={$appSettings.modules}
                        layout={libraryEntityLayout}
                        childContainerClass="relative ml-6 p-3 my-1"
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
                                        Create your first module
                                    </h2>
                                    <p class="mt-2 text-sm text-muted-foreground">
                                        Modules package reusable context, scripts, and display.
                                    </p>
                                    <Button
                                        class="mt-5 gap-2"
                                        disabled={homeAction !== null}
                                        aria-busy={homeAction === 'create-module'}
                                        onclick={handleCreateModule}
                                    >
                                        <Plus class="size-4" />
                                        New Module
                                    </Button>
                                </div>
                            </div>
                        {/snippet}
                        {#snippet item({ entity: mod })}
                            {@const enabled = $appSettings.modules.refs[mod.id]?.enabled ?? true}
                            <div
                                class="flex w-full min-h-32 flex-col items-start rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50 {enabled
                                    ? ''
                                    : 'opacity-60'}"
                            >
                                <div class="flex w-full items-center gap-3">
                                    <div class="flex min-w-0 flex-1 items-center gap-3 text-left">
                                        <div
                                            class="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold"
                                        >
                                            <Package class="size-5 text-muted-foreground" />
                                        </div>
                                        <div class="min-w-0">
                                            <h2 class="truncate text-sm font-semibold">
                                                {mod.name}
                                            </h2>
                                            <p
                                                class="mt-0.5 truncate text-xs text-muted-foreground"
                                            >
                                                {mod.description || 'No description'}
                                            </p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        class="shrink-0 {enabled
                                            ? 'text-amber-500 hover:text-amber-600'
                                            : 'text-muted-foreground'}"
                                        title={enabled
                                            ? 'Deactivate globally'
                                            : 'Activate globally'}
                                        aria-label={enabled
                                            ? 'Deactivate globally'
                                            : 'Activate globally'}
                                        disabled={homeAction !== null}
                                        aria-busy={homeAction === `toggle-module:${mod.id}`}
                                        onclick={(event) => {
                                            event.stopPropagation();
                                            void handleSetModuleEnabled(mod.id, !enabled);
                                        }}
                                    >
                                        <Zap class="size-4 {enabled ? 'fill-amber-500/10' : ''}" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        class="shrink-0 text-muted-foreground hover:text-destructive"
                                        title="Delete module"
                                        aria-label={`Delete ${mod.name}`}
                                        disabled={homeAction !== null}
                                        aria-busy={homeAction === `delete-module:${mod.id}`}
                                        onclick={(event) => {
                                            event.stopPropagation();
                                            handleDeleteModule(mod.id, mod.name);
                                        }}
                                    >
                                        <Trash2 class="size-4" />
                                    </Button>
                                </div>
                                <div
                                    class="mt-auto flex items-center gap-1 pt-5 text-xs text-muted-foreground"
                                >
                                    <Package class="size-3.5" />
                                    Open studio
                                </div>
                            </div>
                        {/snippet}
                    </EntityList>
                {:else if tab === 'personas'}
                    <EntityList
                        entities={filteredPersonas()}
                        config={$appSettings.personas}
                        layout={libraryEntityLayout}
                        childContainerClass="relative ml-6 p-3 my-1"
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
                                        <UserRound class="size-6 text-muted-foreground" />
                                    </div>
                                    <h2 class="mt-4 text-lg font-semibold">
                                        Create your first persona
                                    </h2>
                                    <p class="mt-2 text-sm text-muted-foreground">
                                        Personas are user speakers you can attach to chats.
                                    </p>
                                    <Button
                                        class="mt-5 gap-2"
                                        disabled={homeAction !== null}
                                        aria-busy={homeAction === 'create-persona'}
                                        onclick={handleCreatePersona}
                                    >
                                        <Plus class="size-4" />
                                        New Persona
                                    </Button>
                                </div>
                            </div>
                        {/snippet}
                        {#snippet item({ entity: persona })}
                            <div
                                class="flex w-full min-h-32 flex-col items-start rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50"
                            >
                                <div class="flex w-full items-center gap-3">
                                    <div class="flex min-w-0 flex-1 items-center gap-3 text-left">
                                        <div
                                            class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-sm font-semibold"
                                        >
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
                                                />
                                            {:else}
                                                {initial(persona.name)}
                                            {/if}
                                        </div>
                                        <div class="min-w-0">
                                            <h2 class="truncate text-sm font-semibold">
                                                {persona.name}
                                            </h2>
                                            <p
                                                class="mt-0.5 truncate text-xs text-muted-foreground"
                                            >
                                                {persona.description || 'No description'}
                                            </p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        class="shrink-0 text-muted-foreground hover:text-destructive"
                                        title="Delete persona"
                                        aria-label={`Delete ${persona.name}`}
                                        disabled={homeAction !== null}
                                        aria-busy={homeAction === `delete-persona:${persona.id}`}
                                        onclick={() =>
                                            handleDeletePersona(persona.id, persona.name)}
                                    >
                                        <Trash2 class="size-4" />
                                    </Button>
                                </div>
                                <div
                                    class="mt-auto flex items-center gap-1 pt-5 text-xs text-muted-foreground"
                                >
                                    <UserRound class="size-3.5" />
                                    Open studio
                                </div>
                            </div>
                        {/snippet}
                    </EntityList>
                {/if}
            {/if}
        </div>
    </main>
</div>

<JoinMultiRoomDialog bind:open={joinDialogOpen} />

<MultiRoomManageDialog
    bind:open={manageDialogOpen}
    room={managedRoom}
    meta={managedRoomMeta}
    members={managedRoomMembers}
    currentUserId={$userId}
    error={multiRoomActionError}
    busyMemberId={busyManagedMemberId}
    busyAction={homeAction}
    onVisibilityChange={handleManagedVisibility}
    onApprove={async (memberUserId) => {
        if (!managedRoomId) return;
        await handleApprovePending(managedRoomId, memberUserId);
    }}
    onReject={async (memberUserId) => {
        if (!managedRoomId) return;
        await handleRejectPending(managedRoomId, memberUserId);
    }}
    onRevoke={async (memberUserId) => {
        if (!managedRoomId) return;
        await handleRevokeMember(managedRoomId, memberUserId);
    }}
    onDelete={async () => {
        if (!managedRoomId || !managedRoom) return;
        if (await handleDeleteMultiRoom(managedRoomId, managedRoom.name)) {
            manageDialogOpen = false;
        }
    }}
    onLeave={async () => {
        if (!managedRoomId || !managedRoom) return;
        if (await handleLeaveMultiRoom(managedRoomId, managedRoom.name)) {
            manageDialogOpen = false;
        }
    }}
/>
