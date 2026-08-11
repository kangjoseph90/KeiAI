<script lang="ts">
    import { Plus, Trash2 } from 'lucide-svelte';
    import { Button } from './ui/button';
    import { Input } from './ui/input';
    import { Label } from './ui/label';
    import { t } from '$lib/stores';

    interface Props {
        disabled?: boolean;
        emptyMessage?: string;
        data: Record<string, string>;
        error?: string;
        onUpdateValue: (key: string, value: string) => void | Promise<void>;
        onAdd: (key: string, value: string) => boolean | Promise<boolean> | void | Promise<void>;
        onRemove: (key: string) => void | Promise<void>;
    }

    let {
        disabled = false,
        emptyMessage,
        data,
        error = '',
        onUpdateValue,
        onAdd,
        onRemove
    }: Props = $props();

    const resolvedEmptyMessage = $derived(emptyMessage ?? $t('components.keyValue.empty'));

    let newKey = $state('');
    let newValue = $state('');
    let localError = $state('');

    $effect(() => {
        if (error) {
            localError = error;
        }
    });

    async function handleAdd(event: SubmitEvent) {
        event.preventDefault();
        const key = newKey.trim();
        const val = newValue;

        if (!key) {
            localError = $t('components.keyValue.nameRequired');
            return;
        }
        if (key in data) {
            localError = $t('components.keyValue.nameUnique');
            return;
        }

        localError = '';
        const success = await onAdd(key, val);
        if (success !== false) {
            newKey = '';
            newValue = '';
        }
    }
</script>

<div class="space-y-2">
    <div class="overflow-hidden rounded-lg border bg-background/30 flex flex-col">
        {#if Object.keys(data).length > 0}
            <div class="flex flex-col">
                {#each Object.entries(data) as [key, value] (key)}
                    <div class="flex items-center gap-3 border-b p-2 px-3 last:border-b-0">
                        <!-- Key Label (ReadOnly Flat Text) -->
                        <Label
                            class="h-7 w-36 sm:w-40 shrink-0 flex items-center font-mono text-xs font-medium text-foreground/80 px-1 truncate select-all"
                        >
                            {key}
                        </Label>

                        <!-- Value Input (Compact Flat Design) -->
                        <Input
                            {disabled}
                            class="h-7 flex-1 text-xs bg-background/50 border hover:bg-background border-input rounded px-2 focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0 focus-visible:border-primary"
                            value={String(value)}
                            aria-label={$t('components.keyValue.valueAria', { key })}
                            oninput={(event) => onUpdateValue(key, event.currentTarget.value)}
                        />

                        <!-- Delete Button (Compact Ghost) -->
                        <Button
                            {disabled}
                            variant="ghost"
                            size="icon-sm"
                            class="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onclick={() => onRemove(key)}
                            aria-label={$t('components.keyValue.deleteAria', { key })}
                        >
                            <Trash2 class="size-3.5" />
                        </Button>
                    </div>
                {/each}
            </div>
        {:else}
            <div class="py-6 text-center text-xs text-muted-foreground border-b last:border-b-0">
                {resolvedEmptyMessage}
            </div>
        {/if}

        <form
            class="flex items-center gap-2 bg-muted/15 py-2 px-3 border-t border-border/80"
            onsubmit={handleAdd}
        >
            <Input
                {disabled}
                class="h-7 w-36 sm:w-40 shrink-0 font-mono text-xs bg-background border focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
                bind:value={newKey}
                placeholder={$t('common.label.key')}
                aria-label={$t('components.keyValue.newKeyName')}
            />
            <Input
                {disabled}
                class="h-7 flex-1 text-xs bg-background border focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
                bind:value={newValue}
                placeholder={$t('common.label.value')}
                aria-label={$t('components.keyValue.newKeyValue')}
            />
            <Button
                type="submit"
                size="sm"
                class="h-7 gap-1 px-3 text-xs shrink-0 font-medium"
                {disabled}
            >
                <Plus class="size-3" />
                {$t('components.keyValue.add')}
            </Button>
        </form>
    </div>

    {#if localError}
        <p class="text-xs text-destructive mt-0.5">{localError}</p>
    {/if}
</div>
