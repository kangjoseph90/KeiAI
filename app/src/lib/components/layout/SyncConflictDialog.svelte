<script lang="ts">
    import * as Dialog from '$lib/components/ui/dialog';
    import { Button } from '$lib/components/ui/button';
    import { resolveSyncConflict, t } from '$lib/stores';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';
    import type { SyncConflict, SyncConflictChoice } from '$lib/services/sync';

    interface Props {
        conflict: SyncConflict | undefined;
        open: boolean;
    }

    let { conflict, open = $bindable() }: Props = $props();
    let working = $state(false);
    let errorMsg = $state('');

    const scopeName = $derived(
        conflict?.scope.scopeType === 'room'
            ? $t('shell.sync.conflict.scopeRoom')
            : $t('shell.sync.conflict.scopeUser')
    );

    $effect(() => {
        if (!open) errorMsg = '';
    });

    async function choose(choice: SyncConflictChoice): Promise<void> {
        const target = conflict;
        if (!target || working) return;
        const confirmed = await appConfirm({
            title: $t(
                choice === 'local'
                    ? 'shell.sync.conflict.confirmLocalTitle'
                    : 'shell.sync.conflict.confirmServerTitle'
            ),
            description: $t(
                choice === 'local'
                    ? 'shell.sync.conflict.confirmLocalBody'
                    : 'shell.sync.conflict.confirmServerBody',
                { scope: scopeName }
            ),
            confirmText: $t('shell.sync.conflict.confirmAction'),
            variant: 'destructive'
        });
        if (!confirmed) return;
        working = true;
        errorMsg = '';
        try {
            await resolveSyncConflict(target, choice);
            toast.success({ title: $t('shell.sync.conflict.resolved') });
            open = false;
        } catch (error) {
            errorMsg = $t('shell.sync.conflict.failed', { error: getErrorMessage(error) });
        } finally {
            working = false;
        }
    }
</script>

<Dialog.Root bind:open>
    {#if conflict}
        <Dialog.Content showCloseButton={!working}>
            <Dialog.Header>
                <Dialog.Title>
                    {$t(
                        conflict.kind === 'init'
                            ? 'shell.sync.conflict.titleInit'
                            : 'shell.sync.conflict.titleUnsafe'
                    )}
                </Dialog.Title>
                <Dialog.Description class="whitespace-pre-line">
                    {$t(
                        conflict.kind === 'init'
                            ? 'shell.sync.conflict.bodyInit'
                            : 'shell.sync.conflict.bodyUnsafe',
                        { scope: scopeName }
                    )}
                </Dialog.Description>
            </Dialog.Header>

            <div class="grid gap-2">
                <Button
                    variant="outline"
                    class="h-auto flex-col items-start gap-0.5 whitespace-normal py-2 text-left"
                    disabled={working}
                    onclick={() => void choose('local')}
                >
                    <span class="font-medium">{$t('shell.sync.conflict.keepLocal')}</span>
                    <span class="text-xs font-normal text-muted-foreground">
                        {$t('shell.sync.conflict.keepLocalHint')}
                    </span>
                </Button>
                <Button
                    variant="outline"
                    class="h-auto flex-col items-start gap-0.5 whitespace-normal py-2 text-left"
                    disabled={working}
                    onclick={() => void choose('server')}
                >
                    <span class="font-medium">{$t('shell.sync.conflict.keepServer')}</span>
                    <span class="text-xs font-normal text-muted-foreground">
                        {$t('shell.sync.conflict.keepServerHint')}
                    </span>
                </Button>
            </div>

            {#if errorMsg}
                <p class="text-sm text-destructive" role="alert">{errorMsg}</p>
            {/if}

            <Dialog.Footer>
                <Button variant="ghost" disabled={working} onclick={() => (open = false)}>
                    {working ? $t('shell.sync.conflict.working') : $t('shell.sync.conflict.later')}
                </Button>
            </Dialog.Footer>
        </Dialog.Content>
    {/if}
</Dialog.Root>
