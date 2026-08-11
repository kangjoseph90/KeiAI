<script lang="ts">
    import { type Snippet } from 'svelte';
    import { DoorOpen, Globe2, KeyRound, Lock, Plus, Search, Settings2 } from 'lucide-svelte';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import MediaEntityCard from '$lib/components/entitylist/MediaEntityCard.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import {
        appSettings,
        approveMultiRoomJoinRequest,
        createGlobalFolder,
        deleteGlobalFolder,
        deleteMultiRoom,
        leaveMultiRoom,
        loadMultiRoomMembers,
        loadOwnedMultiRoomMembers,
        moveGlobalItem,
        multiRoomMembers,
        multiRoomMetas,
        multiRooms,
        pbConnected,
        rejectJoinMultiRoom,
        revokeMultiRoomMember,
        selectMultiRoom,
        t,
        updateGlobalFolder,
        updateMultiRoomIndex,
        updateRoom,
        userId
    } from '$lib/stores';
    import { appAlert, appConfirm, toast } from '$lib/ui';
    import type { RouteState } from '$lib/router';
    import { MultiRoomService } from '$lib/services';
    import { formatPublicKeyFingerprint } from '$lib/crypto';
    import { getErrorMessage } from '$lib/types/errors';
    import type { FolderDef } from '$lib/types/refs';
    import MultiRoomManageDialog from './MultiRoomManageDialog.svelte';
    import JoinMultiRoomDialog from './JoinMultiRoomDialog.svelte';
    import CreateMultiRoomDialog from './CreateMultiRoomDialog.svelte';

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

    let query = $state('');
    let homeAction = $state<string | null>(null);
    let multiRoomActionError = $state('');
    let joinDialogOpen = $state(false);
    let createMultiRoomDialogOpen = $state(false);
    let approvingMemberId = $state('');
    let managedRoomId = $state<string | null>(null);
    let manageDialogOpen = $state(false);

    const libraryEntityLayout = 'grid' as const;
    const centeredLibraryGridClass =
        'grid w-full grid-cols-[repeat(auto-fit,10rem)] justify-center gap-2';

    const filteredMultiRooms = $derived(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return $multiRooms;
        return $multiRooms.filter((room) => room.name.toLowerCase().includes(normalized));
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

    $effect(() => {
        if ($pbConnected) {
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
        confirmText = $t('common.confirm.delete')
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
                    title: $t('library.multiRooms.trustTitle'),
                    description: $t('library.multiRooms.trustBody', {
                        user: userLabel,
                        fingerprint: formatted
                    }),
                    confirmText: $t('common.confirm.trust'),
                    variant: 'destructive'
                });
                if (!ok) return;
                await MultiRoomService.trustUserPublicKey(user, fingerprint);
            } else if (trusted.publicKeyFingerprint !== fingerprint) {
                await appAlert({
                    title: $t('library.multiRooms.keyChangedTitle'),
                    description: $t('library.multiRooms.keyChangedBody', {
                        user: userLabel,
                        previous: formatPublicKeyFingerprint(trusted.publicKeyFingerprint),
                        current: formatted
                    })
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

    async function handleManagedSave(
        name: string,
        visibility: 'private' | 'public'
    ): Promise<void> {
        if (!managedRoomId || !managedRoom || !managedRoomMeta) return;
        const trimmedName = name.trim();
        if (!trimmedName) return;

        const roomId = managedRoomId;
        const previousName = managedRoom.name;
        const nameChanged = trimmedName !== previousName;
        const visibilityChanged = visibility !== managedRoomMeta.visibility;
        if (!nameChanged && !visibilityChanged) return;

        await runHomeAction('save-multi-room', $t('library.multiRooms.toast.save'), async () => {
            if (nameChanged) await updateRoom(roomId, { name: trimmedName });

            try {
                if (visibilityChanged || (visibility === 'public' && nameChanged)) {
                    await updateMultiRoomIndex(roomId, {
                        visibility,
                        publicName: visibility === 'public' ? trimmedName : undefined
                    });
                }
            } catch (error) {
                if (nameChanged) await updateRoom(roomId, { name: previousName });
                throw error;
            }
        });
    }

    async function handleRevokeMember(roomId: string, memberUserId: string) {
        if (approvingMemberId) return;
        approvingMemberId = `${roomId}:${memberUserId}`;
        try {
            await runHomeAction(
                `revoke-member:${memberUserId}`,
                $t('library.multiRooms.toast.removeMember'),
                async () => {
                    const confirmed = await appConfirm({
                        title: $t('library.multiRooms.removeMemberTitle'),
                        description: $t('library.multiRooms.removeMemberBody', {
                            user: memberUserId
                        }),
                        confirmText: $t('common.confirm.remove'),
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

    async function handleDeleteMultiRoom(roomId: string, name: string): Promise<boolean> {
        return runConfirmedHomeAction(
            `delete-multi-room:${roomId}`,
            $t('library.multiRooms.toast.delete'),
            $t('library.multiRooms.deleteTitle'),
            $t('library.multiRooms.deleteBody', { name }),
            () => deleteMultiRoom(roomId)
        );
    }

    async function handleLeaveMultiRoom(roomId: string, name: string): Promise<boolean> {
        return runConfirmedHomeAction(
            `leave-multi-room:${roomId}`,
            $t('library.multiRooms.toast.leave'),
            $t('library.multiRooms.leaveTitle'),
            $t('library.multiRooms.leaveBody', { name }),
            () => leaveMultiRoom(roomId),
            $t('common.confirm.leave')
        );
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
                <div class="mx-auto w-full max-w-3xl text-center">
                    <div class="inline-flex items-center gap-2">
                        <h2 class="text-lg font-semibold tracking-tight">
                            {$t('library.multiRooms.title')}
                        </h2>
                        <span
                            class="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground"
                        >
                            {$multiRooms.length}
                        </span>
                    </div>
                    <p class="mt-0.5 text-sm text-muted-foreground">
                        {$t('library.multiRooms.subtitle')}
                    </p>
                </div>

                <div class="mx-auto flex w-full max-w-3xl items-center gap-2">
                    <div class="relative min-w-0 flex-1">
                        <Search
                            class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                            bind:value={query}
                            placeholder={$t('library.search.multiRooms')}
                            class="pl-9"
                        />
                    </div>

                    <Button
                        variant="outline"
                        class="shrink-0 gap-2 px-3"
                        disabled={!$pbConnected}
                        title={$pbConnected
                            ? $t('library.multiRooms.joinTitle')
                            : $t('library.multiRooms.joinSignIn')}
                        onclick={() => (joinDialogOpen = true)}
                    >
                        <KeyRound class="size-4" />
                        <span class="hidden sm:inline">{$t('library.multiRooms.join')}</span>
                    </Button>
                    <Button
                        class="shrink-0 gap-2 px-3"
                        disabled={!$pbConnected}
                        title={$pbConnected
                            ? $t('library.multiRooms.createTitle')
                            : $t('library.multiRooms.createSignIn')}
                        onclick={() => (createMultiRoomDialogOpen = true)}
                    >
                        <Plus class="size-4" />
                        <span class="hidden sm:inline">{$t('library.multiRooms.new')}</span>
                    </Button>
                </div>
            </div>

            {#if $appSettings}
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
                    gridClass={centeredLibraryGridClass}
                    itemWrapperClass={centeredLibraryItemWrapperClass}
                    gridOverlapInset={0.18}
                    folderWrapperClass={centeredLibraryItemWrapperClass}
                    folder={libraryFolder}
                    childContainerClass={libraryLayoutClass(
                        'relative ml-6 p-3 my-1',
                        'relative ml-3 my-1 px-2 py-1.5'
                    )}
                    onItemClick={(room) => openMultiRoom(room.id)}
                    onCreateFolder={(name, parentId, sortOrder) =>
                        createGlobalFolder('multiRooms', name, parentId, sortOrder)}
                    onUpdateFolder={(id, changes) => updateGlobalFolder('multiRooms', id, changes)}
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
                                    {$t('library.multiRooms.emptyTitle')}
                                </h2>
                                <p class="mt-2 text-sm text-muted-foreground">
                                    {$t('library.multiRooms.emptyBody')}
                                </p>
                            </div>
                        </div>
                    {/snippet}
                    {#snippet item({ entity: room })}
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
                        <MediaEntityCard
                            name={room.name}
                            meta={pendingCount > 0
                                ? $t('library.multiRooms.meta', {
                                      members: $t('library.multiRooms.memberCount', {
                                          count: memberCount
                                      }),
                                      pending: pendingCount
                                  })
                                : $t('library.multiRooms.memberCount', { count: memberCount })}
                            class="cursor-pointer"
                        >
                            {#snippet visual()}
                                <div
                                    role="img"
                                    class="text-muted-foreground"
                                    title={meta?.visibility === 'public'
                                        ? $t('library.multiRooms.publicRoom')
                                        : $t('library.multiRooms.privateRoom')}
                                    aria-label={meta?.visibility === 'public'
                                        ? $t('library.multiRooms.publicRoom')
                                        : $t('library.multiRooms.privateRoom')}
                                >
                                    {#if meta?.visibility === 'public'}
                                        <Globe2 class="size-9" />
                                    {:else}
                                        <Lock class="size-9" />
                                    {/if}
                                </div>
                            {/snippet}
                            {#snippet action()}
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    class="size-7 rounded-full border border-border/60 bg-background/85 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-background hover:text-foreground"
                                    title={$t('library.multiRooms.manage')}
                                    aria-label={$t('library.multiRooms.manageNamed', {
                                        name: room.name
                                    })}
                                    onclick={(event) => {
                                        event.stopPropagation();
                                        handleOpenMultiRoomManagement(room.id);
                                    }}
                                >
                                    <Settings2 class="size-4" />
                                </Button>
                            {/snippet}
                        </MediaEntityCard>
                    {/snippet}
                </EntityList>
            {/if}
        </div>
    </main>
</div>

<JoinMultiRoomDialog bind:open={joinDialogOpen} />

<CreateMultiRoomDialog
    bind:open={createMultiRoomDialogOpen}
    onCreated={(roomId) => openMultiRoom(roomId)}
/>

<MultiRoomManageDialog
    bind:open={manageDialogOpen}
    room={managedRoom}
    meta={managedRoomMeta}
    members={managedRoomMembers}
    currentUserId={$userId}
    error={multiRoomActionError}
    busyMemberId={busyManagedMemberId}
    busyAction={homeAction}
    onSave={handleManagedSave}
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
