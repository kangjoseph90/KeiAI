<script lang="ts">
    import { Globe2, Lock, Plus } from 'lucide-svelte';
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
    import { createMultiRoom, t } from '$lib/stores';
    import { getErrorMessage } from '$lib/types/errors';
    import { toast } from '$lib/ui';

    interface Props {
        open: boolean;
        onCreated?: (roomId: string) => void | Promise<void>;
    }

    let { open = $bindable(), onCreated = undefined }: Props = $props();

    let roomName = $state('');
    let visibility = $state<'private' | 'public'>('private');
    let errorMessage = $state('');
    let creating = $state(false);

    function resetForm(): void {
        roomName = '';
        visibility = 'private';
        errorMessage = '';
    }

    $effect(() => {
        if (!open) resetForm();
    });

    async function handleCreate(): Promise<void> {
        const trimmedName = roomName.trim();
        if (!trimmedName || creating) return;

        creating = true;
        errorMessage = '';
        try {
            const room = await createMultiRoom({
                name: trimmedName,
                publicName: visibility === 'public' ? trimmedName : undefined,
                visibility
            });

            resetForm();
            open = false;
            toast.success({
                title: $t('library.multiRoomDialog.createdTitle'),
                description: $t('library.multiRoomDialog.createdBody')
            });
            await onCreated?.(room.id);
        } catch (error) {
            errorMessage = getErrorMessage(error);
        } finally {
            creating = false;
        }
    }
</script>

<Dialog bind:open>
    <DialogContent class="gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader class="border-b px-4 py-4 pr-12 text-left sm:px-6 sm:py-5">
            <DialogTitle class="text-lg">{$t('library.multiRoomDialog.createTitle')}</DialogTitle>
            <DialogDescription>
                {$t('library.multiRoomDialog.createDescription')}
            </DialogDescription>
        </DialogHeader>

        <form
            class="space-y-5 p-4 sm:p-6"
            aria-busy={creating}
            onsubmit={(event) => {
                event.preventDefault();
                void handleCreate();
            }}
        >
            <div class="space-y-2">
                <Label for="create-multi-room-name">{$t('library.multiRoomDialog.roomName')}</Label>
                <Input
                    id="create-multi-room-name"
                    bind:value={roomName}
                    placeholder={$t('library.multiRoomDialog.placeholder')}
                    autocomplete="off"
                    autofocus
                />
            </div>

            <fieldset class="space-y-2">
                <legend class="text-sm font-medium"
                    >{$t('library.multiRoomDialog.visibility')}</legend
                >
                <div class="grid gap-2 sm:grid-cols-2">
                    <button
                        type="button"
                        class="flex min-w-0 items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors {visibility ===
                        'private'
                            ? 'border-foreground/25 bg-accent/50'
                            : 'hover:bg-muted/50'}"
                        aria-pressed={visibility === 'private'}
                        onclick={() => (visibility = 'private')}
                    >
                        <Lock class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        <span class="min-w-0">
                            <span class="block text-sm font-medium"
                                >{$t('library.multiRoomDialog.private')}</span
                            >
                            <span class="mt-0.5 block text-xs text-muted-foreground">
                                {$t('library.multiRoomDialog.privateDescription')}
                            </span>
                        </span>
                    </button>
                    <button
                        type="button"
                        class="flex min-w-0 items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors {visibility ===
                        'public'
                            ? 'border-foreground/25 bg-accent/50'
                            : 'hover:bg-muted/50'}"
                        aria-pressed={visibility === 'public'}
                        onclick={() => (visibility = 'public')}
                    >
                        <Globe2 class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        <span class="min-w-0">
                            <span class="block text-sm font-medium"
                                >{$t('library.multiRoomDialog.public')}</span
                            >
                            <span class="mt-0.5 block text-xs text-muted-foreground">
                                {$t('library.multiRoomDialog.publicDescription')}
                            </span>
                        </span>
                    </button>
                </div>
            </fieldset>

            {#if errorMessage}
                <div
                    class="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
                    role="alert"
                >
                    {errorMessage}
                </div>
            {/if}

            <DialogFooter class="flex-row justify-end gap-2 border-t pt-4">
                <Button
                    type="button"
                    variant="ghost"
                    onclick={() => (open = false)}
                    disabled={creating}
                >
                    {$t('common.actions.cancel')}
                </Button>
                <Button
                    type="submit"
                    class="gap-2"
                    disabled={creating || !roomName.trim()}
                    aria-busy={creating}
                >
                    <Plus class="size-4" />
                    {$t('library.multiRoomDialog.createButton')}
                </Button>
            </DialogFooter>
        </form>
    </DialogContent>
</Dialog>
