<script lang="ts">
    import { Globe2, KeyRound, Search, UsersRound } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import {
        Dialog,
        DialogContent,
        DialogDescription,
        DialogHeader,
        DialogTitle
    } from '$lib/components/ui/dialog';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { requestJoinMultiRoom } from '$lib/stores';
    import { MultiRoomService, type PublicMultiRoom } from '$lib/services';
    import { getErrorMessage } from '$lib/types/errors';
    import { toast } from '$lib/ui';

    interface Props {
        open: boolean;
    }

    let { open = $bindable() }: Props = $props();

    let mode = $state<'code' | 'discover'>('code');
    let roomId = $state('');
    let query = $state('');
    let results = $state<PublicMultiRoom[]>([]);
    let errorMessage = $state('');
    let searching = $state(false);
    let joining = $state(false);
    let hasSearched = $state(false);

    async function requestAccess(id: string): Promise<void> {
        const trimmed = id.trim();
        if (!trimmed || joining) return;

        joining = true;
        errorMessage = '';
        try {
            await requestJoinMultiRoom(trimmed);
            roomId = '';
            open = false;
            toast.success({
                title: 'Join request sent',
                description: 'A room owner needs to approve your request.'
            });
        } catch (error) {
            errorMessage = getErrorMessage(error);
        } finally {
            joining = false;
        }
    }

    async function searchPublicRooms(): Promise<void> {
        if (searching) return;

        searching = true;
        hasSearched = true;
        errorMessage = '';
        try {
            results = await MultiRoomService.searchPublicRooms(query);
        } catch (error) {
            errorMessage = getErrorMessage(error);
        } finally {
            searching = false;
        }
    }
</script>

<Dialog bind:open>
    <DialogContent class="gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader class="border-b px-4 py-4 pr-12 text-left sm:px-6 sm:py-5">
            <div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <UsersRound class="size-3.5" /> Multi Rooms
            </div>
            <DialogTitle class="text-lg">Join a shared room</DialogTitle>
            <DialogDescription>
                Request access with a room ID or discover public rooms.
            </DialogDescription>
        </DialogHeader>

        <div class="p-4 sm:p-6" aria-busy={searching || joining}>
            <div class="mb-5 grid grid-cols-2 rounded-md border bg-muted/30 p-1">
                <button
                    type="button"
                    class="flex items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium transition-colors {mode ===
                    'code'
                        ? 'bg-background shadow-sm dark:bg-accent'
                        : 'text-muted-foreground hover:text-foreground'}"
                    onclick={() => {
                        mode = 'code';
                        errorMessage = '';
                    }}
                >
                    <KeyRound class="size-4" /> Room ID
                </button>
                <button
                    type="button"
                    class="flex items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium transition-colors {mode ===
                    'discover'
                        ? 'bg-background shadow-sm dark:bg-accent'
                        : 'text-muted-foreground hover:text-foreground'}"
                    onclick={() => {
                        mode = 'discover';
                        errorMessage = '';
                    }}
                >
                    <Globe2 class="size-4" /> Discover
                </button>
            </div>

            {#if mode === 'code'}
                <form
                    class="space-y-4"
                    onsubmit={(event) => {
                        event.preventDefault();
                        void requestAccess(roomId);
                    }}
                >
                    <div class="space-y-2">
                        <Label for="multi-room-id">Room ID</Label>
                        <Input
                            id="multi-room-id"
                            bind:value={roomId}
                            placeholder="Paste a room ID"
                            autocomplete="off"
                            autofocus
                        />
                        <p class="text-xs text-muted-foreground">
                            Ask a member for the room ID. Joining always requires owner approval.
                        </p>
                    </div>
                    <Button
                        type="submit"
                        class="w-full gap-2"
                        disabled={joining || !roomId.trim()}
                        aria-busy={joining}
                    >
                        <KeyRound class="size-4" /> Request access
                    </Button>
                </form>
            {:else}
                <div class="space-y-4">
                    <form
                        class="flex gap-2"
                        onsubmit={(event) => {
                            event.preventDefault();
                            void searchPublicRooms();
                        }}
                    >
                        <div class="relative min-w-0 flex-1">
                            <Search
                                class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                            />
                            <Input
                                bind:value={query}
                                class="pl-9"
                                placeholder="Search public rooms"
                                aria-label="Search public rooms"
                            />
                        </div>
                        <Button
                            type="submit"
                            size="icon"
                            aria-label="Search public rooms"
                            disabled={searching}
                            aria-busy={searching}
                        >
                            <Search class="size-4" />
                        </Button>
                    </form>

                    {#if results.length > 0}
                        <div class="max-h-64 divide-y overflow-y-auto rounded-md border">
                            {#each results as result (result.id)}
                                <div class="flex min-w-0 items-center justify-between gap-3 p-3">
                                    <div class="min-w-0">
                                        <p class="truncate text-sm font-medium">
                                            {result.publicName || result.id}
                                        </p>
                                        <p
                                            class="truncate font-mono text-[11px] text-muted-foreground"
                                        >
                                            {result.id}
                                        </p>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        class="shrink-0 gap-1.5"
                                        disabled={joining}
                                        onclick={() => requestAccess(result.id)}
                                    >
                                        <KeyRound class="size-3.5" /> Request
                                    </Button>
                                </div>
                            {/each}
                        </div>
                    {:else if hasSearched && !searching && !errorMessage}
                        <div class="rounded-md border border-dashed px-4 py-8 text-center">
                            <Globe2 class="mx-auto size-5 text-muted-foreground" />
                            <p class="mt-2 text-sm font-medium">No public rooms found</p>
                            <p class="mt-1 text-xs text-muted-foreground">
                                Try another name or join with a room ID.
                            </p>
                        </div>
                    {:else}
                        <div class="rounded-md bg-muted/30 px-4 py-5 text-sm text-muted-foreground">
                            Public rooms are discoverable, but owners still approve every member.
                        </div>
                    {/if}
                </div>
            {/if}

            {#if errorMessage}
                <div
                    class="mt-4 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
                    role="alert"
                >
                    {errorMessage}
                </div>
            {/if}
        </div>
    </DialogContent>
</Dialog>
