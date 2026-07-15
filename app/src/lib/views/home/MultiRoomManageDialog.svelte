<script lang="ts">
    import {
        Check,
        Crown,
        Globe2,
        Lock,
        LogOut,
        Shield,
        Trash2,
        UserMinus,
        X
    } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import {
        Dialog,
        DialogContent,
        DialogDescription,
        DialogFooter,
        DialogHeader,
        DialogTitle
    } from '$lib/components/ui/dialog';
    import type { MultiRoom, MultiRoomMember, Room } from '$lib/services';

    interface Props {
        open: boolean;
        room: Room | null;
        meta: MultiRoom | null;
        members: MultiRoomMember[];
        currentUserId: string | null;
        busyMemberId?: string | null;
        busyAction?: string | null;
        onVisibilityChange: (visibility: MultiRoom['visibility']) => Promise<void>;
        onApprove: (userId: string) => Promise<void>;
        onReject: (userId: string) => Promise<void>;
        onRevoke: (userId: string) => Promise<void>;
        onDelete: () => Promise<void>;
        onLeave: () => Promise<void>;
    }

    let {
        open = $bindable(),
        room,
        meta,
        members,
        currentUserId,
        busyMemberId = null,
        busyAction = null,
        onVisibilityChange,
        onApprove,
        onReject,
        onRevoke,
        onDelete,
        onLeave
    }: Props = $props();

    const isOwner = $derived(Boolean(meta && currentUserId && meta.ownerUserId === currentUserId));
    const acceptedMembers = $derived(members.filter((member) => member.status === 'accepted'));
    const pendingMembers = $derived(members.filter((member) => member.status === 'pending'));
</script>

<Dialog bind:open>
    <DialogContent class="p-0 sm:max-w-xl">
        <DialogHeader class="border-b px-4 py-4 pr-12 text-left sm:px-6 sm:py-5">
            <div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Shield class="size-3.5" />
                Multi Room
            </div>
            <DialogTitle class="text-lg">{room?.name ?? 'Room management'}</DialogTitle>
            <DialogDescription>
                {isOwner ? 'Manage access and membership.' : 'View members or leave this room.'}
            </DialogDescription>
        </DialogHeader>

        {#if room && meta}
            <div class="divide-y" aria-busy={busyAction !== null || busyMemberId !== null}>
                <section class="space-y-3 px-4 py-4 sm:px-6">
                    <div
                        class="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center sm:gap-4"
                    >
                        <div>
                            <h3 class="text-sm font-medium">Visibility</h3>
                            <p class="mt-0.5 text-xs text-muted-foreground">
                                Public rooms appear in discovery. Joining still requires approval.
                            </p>
                        </div>
                        <div class="flex rounded-md border bg-muted/30 p-1 max-sm:[&>*]:flex-1">
                            <Button
                                size="sm"
                                variant={meta.visibility === 'private' ? 'secondary' : 'ghost'}
                                class="h-7 gap-1.5 px-2.5 text-xs"
                                disabled={!isOwner || busyAction !== null || busyMemberId !== null}
                                aria-busy={busyAction === 'manage-visibility'}
                                onclick={() => onVisibilityChange('private')}
                            >
                                <Lock class="size-3.5" /> Private
                            </Button>
                            <Button
                                size="sm"
                                variant={meta.visibility === 'public' ? 'secondary' : 'ghost'}
                                class="h-7 gap-1.5 px-2.5 text-xs"
                                disabled={!isOwner || busyAction !== null || busyMemberId !== null}
                                aria-busy={busyAction === 'manage-visibility'}
                                onclick={() => onVisibilityChange('public')}
                            >
                                <Globe2 class="size-3.5" /> Public
                            </Button>
                        </div>
                    </div>
                    <div
                        class="rounded-md bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground"
                    >
                        {room.id}
                    </div>
                </section>

                {#if isOwner && pendingMembers.length > 0}
                    <section class="px-4 py-4 sm:px-6">
                        <h3 class="text-sm font-medium">Join requests</h3>
                        <div class="mt-3 divide-y rounded-md border">
                            {#each pendingMembers as member (member.id)}
                                <div class="flex items-center justify-between gap-3 px-3 py-2.5">
                                    <span class="min-w-0 truncate text-sm">{member.userId}</span>
                                    <div class="flex shrink-0 gap-1">
                                        <Button
                                            size="icon-sm"
                                            variant="outline"
                                            title="Approve member"
                                            disabled={busyAction !== null || busyMemberId !== null}
                                            onclick={() => onApprove(member.userId)}
                                        >
                                            <Check class="size-4" />
                                        </Button>
                                        <Button
                                            size="icon-sm"
                                            variant="ghost"
                                            title="Reject request"
                                            disabled={busyAction !== null || busyMemberId !== null}
                                            onclick={() => onReject(member.userId)}
                                        >
                                            <X class="size-4" />
                                        </Button>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    </section>
                {/if}

                <section class="px-4 py-4 sm:px-6">
                    <div class="flex items-center justify-between">
                        <h3 class="text-sm font-medium">Members</h3>
                        <span class="text-xs text-muted-foreground">{acceptedMembers.length}</span>
                    </div>
                    <div class="mt-3 divide-y rounded-md border">
                        {#each acceptedMembers as member (member.id)}
                            {@const memberIsOwner = member.userId === meta.ownerUserId}
                            <div class="flex items-center justify-between gap-3 px-3 py-2.5">
                                <div class="flex min-w-0 items-center gap-2">
                                    {#if memberIsOwner}
                                        <Crown class="size-4 shrink-0 text-primary" />
                                    {:else}
                                        <Shield class="size-4 shrink-0 text-muted-foreground" />
                                    {/if}
                                    <div class="min-w-0">
                                        <p class="truncate text-sm">{member.userId}</p>
                                        <p class="text-[11px] text-muted-foreground">
                                            {memberIsOwner
                                                ? 'Owner'
                                                : member.userId === currentUserId
                                                  ? 'You'
                                                  : 'Member'}
                                        </p>
                                    </div>
                                </div>
                                {#if isOwner && !memberIsOwner}
                                    <Button
                                        size="icon-sm"
                                        variant="ghost"
                                        class="text-muted-foreground hover:text-destructive"
                                        title="Remove member"
                                        disabled={busyAction !== null || busyMemberId !== null}
                                        aria-busy={busyAction === `revoke-member:${member.userId}`}
                                        onclick={() => onRevoke(member.userId)}
                                    >
                                        <UserMinus class="size-4" />
                                    </Button>
                                {/if}
                            </div>
                        {/each}
                    </div>
                </section>
            </div>

            <DialogFooter class="border-t px-4 py-4 sm:px-6">
                {#if isOwner}
                    <Button
                        variant="destructive"
                        class="gap-2"
                        disabled={busyAction !== null || busyMemberId !== null}
                        aria-busy={busyAction === `delete-multi-room:${room.id}`}
                        onclick={onDelete}
                    >
                        <Trash2 class="size-4" /> Delete room
                    </Button>
                {:else}
                    <Button
                        variant="outline"
                        class="gap-2 text-destructive"
                        disabled={busyAction !== null || busyMemberId !== null}
                        aria-busy={busyAction === `leave-multi-room:${room.id}`}
                        onclick={onLeave}
                    >
                        <LogOut class="size-4" /> Leave room
                    </Button>
                {/if}
            </DialogFooter>
        {/if}
    </DialogContent>
</Dialog>
