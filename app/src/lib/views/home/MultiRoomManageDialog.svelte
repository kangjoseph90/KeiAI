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
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import type { MultiRoom, MultiRoomMember, Room } from '$lib/services';

    interface Props {
        open: boolean;
        room: Room | null;
        meta: MultiRoom | null;
        members: MultiRoomMember[];
        currentUserId: string | null;
        error?: string;
        busyMemberId?: string | null;
        busyAction?: string | null;
        onSave: (name: string, visibility: MultiRoom['visibility']) => Promise<void>;
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
        error = '',
        busyMemberId = null,
        busyAction = null,
        onSave,
        onApprove,
        onReject,
        onRevoke,
        onDelete,
        onLeave
    }: Props = $props();

    const isOwner = $derived(Boolean(meta && currentUserId && meta.ownerUserId === currentUserId));
    const acceptedMembers = $derived(members.filter((member) => member.status === 'accepted'));
    const pendingMembers = $derived(members.filter((member) => member.status === 'pending'));
    let nameDraft = $state('');
    let visibilityDraft = $state<MultiRoom['visibility']>('private');
    let saving = $state(false);
    let wasOpen = $state(false);
    let previousRoomName = $state('');
    let previousVisibility = $state<MultiRoom['visibility']>('private');

    const trimmedName = $derived(nameDraft.trim());
    const hasChanges = $derived(
        Boolean(room && meta) &&
            (trimmedName !== (room?.name ?? '') ||
                visibilityDraft !== (meta?.visibility ?? 'private'))
    );
    const busy = $derived(saving || busyAction !== null || busyMemberId !== null);
    const canSave = $derived(isOwner && Boolean(trimmedName) && hasChanges && !busy);

    $effect(() => {
        const savedName = room?.name ?? '';
        const savedVisibility = meta?.visibility ?? 'private';

        if (!open) {
            nameDraft = '';
            visibilityDraft = 'private';
            wasOpen = false;
        } else if (
            !wasOpen ||
            savedName !== previousRoomName ||
            savedVisibility !== previousVisibility
        ) {
            nameDraft = savedName;
            visibilityDraft = savedVisibility;
            wasOpen = true;
        }

        previousRoomName = savedName;
        previousVisibility = savedVisibility;
    });

    async function saveChanges(): Promise<void> {
        if (!canSave || saving) return;

        saving = true;
        try {
            await onSave(trimmedName, visibilityDraft);
        } finally {
            saving = false;
        }
    }
</script>

<Dialog bind:open>
    <DialogContent class="p-0 sm:max-w-xl">
        <DialogHeader class="border-b px-4 py-4 pr-12 text-left sm:px-6 sm:py-5">
            <DialogTitle class="text-lg">
                {isOwner ? 'Manage Multi Room' : (room?.name ?? 'Multi Room')}
            </DialogTitle>
            <DialogDescription>
                {isOwner
                    ? 'Manage room settings, access, and membership.'
                    : 'View members or leave this room.'}
            </DialogDescription>
        </DialogHeader>

        {#if room && meta}
            <div class="divide-y" aria-busy={busy}>
                {#if error}
                    <div
                        class="border-b border-destructive/20 bg-destructive/10 px-5 py-3 text-sm text-destructive"
                    >
                        {error}
                    </div>
                {/if}
                <section class="space-y-3 px-5 py-3">
                    {#if isOwner}
                        <div class="space-y-1.5">
                            <div class="min-w-0 flex-1 space-y-1.5">
                                <Label for="multi-room-name">Room name</Label>
                                <Input
                                    id="multi-room-name"
                                    bind:value={nameDraft}
                                    class="h-9"
                                    disabled={busy}
                                    placeholder="Multi room name..."
                                />
                            </div>
                        </div>
                    {/if}
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
                                variant={visibilityDraft === 'private' ? 'secondary' : 'ghost'}
                                class="h-7 gap-1.5 px-2.5 text-xs"
                                disabled={!isOwner || busy}
                                aria-pressed={visibilityDraft === 'private'}
                                onclick={() => (visibilityDraft = 'private')}
                            >
                                <Lock class="size-3.5" /> Private
                            </Button>
                            <Button
                                size="sm"
                                variant={visibilityDraft === 'public' ? 'secondary' : 'ghost'}
                                class="h-7 gap-1.5 px-2.5 text-xs"
                                disabled={!isOwner || busy}
                                aria-pressed={visibilityDraft === 'public'}
                                onclick={() => (visibilityDraft = 'public')}
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
                    <section class="px-5 py-3">
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
                                            aria-label={`Approve ${member.userId}`}
                                            disabled={busy}
                                            onclick={() => onApprove(member.userId)}
                                        >
                                            <Check class="size-4" />
                                        </Button>
                                        <Button
                                            size="icon-sm"
                                            variant="ghost"
                                            title="Reject request"
                                            aria-label={`Reject ${member.userId}`}
                                            disabled={busy}
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

                <section class="px-5 py-3">
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
                                        aria-label={`Remove ${member.userId}`}
                                        disabled={busy}
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

            <DialogFooter class="flex-row items-center gap-2 border-t px-5 py-3 sm:justify-between">
                {#if isOwner}
                    <Button
                        size="sm"
                        variant="destructive"
                        class="h-8 gap-1.5 px-3"
                        disabled={busy}
                        aria-busy={busyAction === `delete-multi-room:${room.id}`}
                        onclick={onDelete}
                    >
                        <Trash2 class="size-4" /> Delete room
                    </Button>
                    <Button
                        size="sm"
                        class="ml-auto h-8 gap-1.5 px-3"
                        disabled={!canSave}
                        aria-busy={saving}
                        onclick={saveChanges}
                    >
                        Save changes
                    </Button>
                {:else}
                    <Button
                        size="sm"
                        variant="outline"
                        class="ml-auto h-8 gap-1.5 px-3 text-destructive"
                        disabled={busy}
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
