<script lang="ts">
    import { dismissPorterOperation, porterOperation } from '$lib/ui';
    import type { PorterOperationEntity } from '$lib/ui';
    import type { PorterPhase } from '$lib/porters/progress';
    import type { MessageKey } from '$lib/language';
    import * as Dialog from '$lib/components/ui/dialog';
    import { Button } from '$lib/components/ui/button';
    import { Loader2 } from 'lucide-svelte';
    import { t } from '$lib/stores';

    const PHASE_LABEL_KEYS = {
        preparing: 'components.porterProgress.phasePreparing',
        'processing-data': 'components.porterProgress.phaseProcessingData',
        'processing-assets': 'components.porterProgress.phaseProcessingAssets',
        finalizing: 'components.porterProgress.phaseFinalizing'
    } as const satisfies Record<PorterPhase, MessageKey>;

    const ENTITY_LABEL_KEYS = {
        character: 'components.porterProgress.character',
        persona: 'components.porterProgress.persona',
        module: 'components.porterProgress.module'
    } as const satisfies Record<PorterOperationEntity, MessageKey>;

    const operation = $derived($porterOperation);
    const failed = $derived(operation?.error !== undefined);
    const title = $derived(
        operation
            ? $t(
                  operation.kind === 'import'
                      ? 'components.porterProgress.importTitle'
                      : 'components.porterProgress.exportTitle',
                  { entity: $t(ENTITY_LABEL_KEYS[operation.entity]) }
              )
            : ''
    );
    const percent = $derived(
        operation && operation.total > 0
            ? Math.min(100, Math.round((operation.completed / operation.total) * 100))
            : 0
    );

    // The dialog must stay open while the operation runs; only a confirmed
    // failure may be dismissed by the user.
    function handleOpenChange(open: boolean): void {
        if (!open && failed) dismissPorterOperation();
    }
</script>

<Dialog.Root open={operation !== undefined} onOpenChange={handleOpenChange}>
    {#if operation}
        <Dialog.Content showCloseButton={false}>
            <Dialog.Header>
                <Dialog.Title>{title}</Dialog.Title>
                <Dialog.Description class={failed ? 'text-destructive' : undefined}>
                    {failed
                        ? $t('components.porterProgress.failed')
                        : $t(PHASE_LABEL_KEYS[operation.phase])}
                </Dialog.Description>
            </Dialog.Header>

            {#if failed}
                {#if operation.error}
                    <p class="text-destructive text-sm whitespace-pre-line">{operation.error}</p>
                {/if}
            {:else}
                <div class="grid gap-2">
                    <div class="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 class="size-4 shrink-0 animate-spin text-primary" />
                        {#if operation.total > 0}
                            <span>
                                {$t('components.porterProgress.assetsCount', {
                                    current: operation.completed,
                                    total: operation.total
                                })}
                            </span>
                        {/if}
                    </div>
                    {#if operation.total > 0}
                        <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                                class="h-full rounded-full bg-primary transition-all"
                                style={`width: ${percent}%`}
                            ></div>
                        </div>
                    {/if}
                </div>
            {/if}

            {#if failed}
                <Dialog.Footer>
                    <Button type="button" variant="outline" onclick={dismissPorterOperation}>
                        {$t('common.actions.close')}
                    </Button>
                </Dialog.Footer>
            {/if}
        </Dialog.Content>
    {/if}
</Dialog.Root>
