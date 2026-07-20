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

    function handleOpenChange(open: boolean): void {
        const request = current;
        if (!open && request) cancelModal(request);
    }
</script>

<Dialog.Root open={current !== undefined} onOpenChange={handleOpenChange}>
    {#if current}
        <Dialog.Content showCloseButton={false}>
            <Dialog.Header>
                <Dialog.Title>{current.title}</Dialog.Title>
                {#if current.description}
                    <Dialog.Description class="whitespace-pre-line"
                        >{current.description}</Dialog.Description
                    >
                {/if}
            </Dialog.Header>

            {#if current.type === 'prompt'}
                <Input
                    bind:value={promptValue}
                    placeholder={current.placeholder}
                    aria-label={current.title}
                    autofocus
                    onkeydown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            resolveModal(current, promptValue);
                        }
                    }}
                />
            {/if}

            <Dialog.Footer
                class={current.type === 'alert' ? undefined : 'grid grid-cols-2 sm:flex'}
            >
                {#if current.type !== 'alert'}
                    <Button type="button" variant="outline" onclick={() => cancelModal(current)}>
                        {current.cancelText}
                    </Button>
                {/if}
                <Button
                    type="button"
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
