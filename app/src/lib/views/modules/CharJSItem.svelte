<script lang="ts">
    import type { CharJS } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { Button } from '$lib/components/ui/button';
    import EditableListItem from '$lib/components/entitylist/EditableListItem.svelte';
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Label } from '$lib/components/ui/label';
    import { ChevronDown, ChevronRight, Eye, EyeOff, GripVertical, Trash2 } from 'lucide-svelte';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';
    import { t } from '$lib/stores';

    let {
        item,
        initiallyEditing = false,
        onUpdate,
        onDelete
    }: {
        item: CharJS;
        initiallyEditing?: boolean;
        onUpdate: (id: string, changes: DeepPartial<CharJS>) => void | Promise<void>;
        onDelete: (id: string) => void | Promise<void>;
    } = $props();

    let expanded = $state(false);
    let openedInitially = $state(false);
    let busy = $state(false);

    $effect(() => {
        if (initiallyEditing && !openedInitially) {
            openedInitially = true;
            expanded = true;
        }
    });

    async function handleUpdate(changes: DeepPartial<CharJS>): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            await onUpdate(item.id, changes);
        } catch (error) {
            toast.error({
                title: $t('module.charjsItem.toast.update'),
                description: getErrorMessage(error)
            });
        } finally {
            busy = false;
        }
    }

    async function handleDelete(): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            const confirmed = await appConfirm({
                title: $t('module.charjsItem.deleteTitle'),
                description: $t('module.charjsItem.deleteBody', { name: item.name }),
                confirmText: $t('common.confirm.delete'),
                variant: 'destructive'
            });
            if (!confirmed) return;
            await onDelete(item.id);
        } catch (error) {
            toast.error({
                title: $t('module.charjsItem.toast.delete'),
                description: getErrorMessage(error)
            });
        } finally {
            busy = false;
        }
    }
</script>

<EditableListItem {expanded} {busy} muted={!item.enabled}>
    {#snippet header()}
        <div
            class="flex h-7 w-4 shrink-0 cursor-grab active:cursor-grabbing select-none items-center justify-center text-muted-foreground/45 transition-colors hover:text-muted-foreground"
            aria-hidden="true"
        >
            <GripVertical class="size-3.5" />
        </div>
        <button
            type="button"
            class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onclick={() => (expanded = !expanded)}
            aria-label={expanded
                ? $t('module.charjsItem.collapseAria')
                : $t('module.charjsItem.expandAria')}
        >
            {#if expanded}
                <ChevronDown class="size-3.5" />
            {:else}
                <ChevronRight class="size-3.5" />
            {/if}
        </button>

        <Input
            disabled={busy}
            value={item.name}
            aria-label={$t('module.charjsItem.nameAria')}
            class="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 font-medium shadow-none focus-visible:ring-0 dark:bg-transparent text-sm leading-relaxed"
            onchange={(e) => handleUpdate({ name: e.currentTarget.value })}
        />

        <Button
            size="icon-sm"
            variant="ghost"
            class="shrink-0 text-muted-foreground"
            title={item.enabled ? $t('module.charjsItem.disable') : $t('module.charjsItem.enable')}
            aria-label={item.enabled
                ? $t('module.charjsItem.disable')
                : $t('module.charjsItem.enable')}
            disabled={busy}
            onclick={() => handleUpdate({ enabled: !item.enabled })}
        >
            {#if item.enabled}
                <Eye class="size-3.5" />
            {:else}
                <EyeOff class="size-3.5" />
            {/if}
        </Button>
        <Button
            size="icon-sm"
            variant="ghost"
            class="shrink-0 text-muted-foreground hover:text-destructive"
            title={$t('module.charjsItem.deleteAria')}
            aria-label={$t('module.charjsItem.deleteAria')}
            disabled={busy}
            onclick={handleDelete}
        >
            <Trash2 class="size-3.5" />
        </Button>
    {/snippet}

    {#snippet details()}
        <div class="space-y-1.5">
            <Label class="text-xs">{$t('module.charjsItem.codeLabel')}</Label>
            <Textarea
                disabled={busy}
                class="min-h-48 resize-y bg-background font-mono text-sm leading-relaxed"
                value={item.code}
                placeholder={$t('module.charjsItem.codePlaceholder')}
                onchange={(e) => handleUpdate({ code: e.currentTarget.value })}
            />
        </div>
    {/snippet}
</EditableListItem>
