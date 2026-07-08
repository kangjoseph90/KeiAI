<script lang="ts">
    import { modalQueue } from '$lib/ui/state';
    import { cancelModal, resolveModal } from '$lib/ui/modal';
    import * as Dialog from '$lib/components/ui/dialog';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';

    const current = $derived($modalQueue[0]);
    let promptValue = $state('');
    let lastPromptId = '';

    $effect(() => {
        if (current?.type === 'prompt' && current.id !== lastPromptId) {
            promptValue = current.defaultValue;
            lastPromptId = current.id;
        }
    });
</script>

<Dialog.Root open={current !== undefined}>
    {#if current}
        <Dialog.Content showCloseButton={false}>
            <Dialog.Header>
                <Dialog.Title>{current.title}</Dialog.Title>
                {#if current.description}
                    <Dialog.Description>{current.description}</Dialog.Description>
                {/if}
            </Dialog.Header>

            {#if current.type === 'prompt'}
                <Input
                    bind:value={promptValue}
                    placeholder={current.placeholder}
                    onkeydown={(event) => {
                        if (event.key === 'Enter') resolveModal(current, promptValue);
                        if (event.key === 'Escape') cancelModal(current);
                    }}
                />
            {/if}

            <Dialog.Footer>
                {#if current.type !== 'alert'}
                    <Button variant="outline" onclick={() => cancelModal(current)}>
                        {current.cancelText}
                    </Button>
                {/if}
                <Button
                    variant={current.type === 'confirm' && current.variant === 'destructive'
                        ? 'destructive'
                        : 'default'}
                    onclick={() => resolveModal(current, promptValue)}
                >
                    {current.confirmText}
                </Button>
            </Dialog.Footer>
        </Dialog.Content>
    {/if}
</Dialog.Root>
