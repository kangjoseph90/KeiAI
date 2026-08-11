<script lang="ts">
    import { ChevronDown, ChevronRight, GripVertical, Trash2 } from 'lucide-svelte';
    import type { ChatCommand } from '$lib/types/command';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import EditableListItem from '$lib/components/entitylist/EditableListItem.svelte';
    import WorkflowEditorModal from '$lib/views/workflow/WorkflowEditorModal.svelte';
    import WorkflowSummaryCard from '$lib/views/workflow/WorkflowSummaryCard.svelte';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    let {
        item,
        initiallyEditing = false,
        onUpdate,
        onDelete
    }: {
        item: ChatCommand;
        initiallyEditing?: boolean;
        onUpdate: (id: string, changes: DeepPartial<ChatCommand>) => void | Promise<void>;
        onDelete: (id: string) => void | Promise<void>;
    } = $props();

    let expanded = $state(false);
    let openedInitially = $state(false);
    let workflowOpen = $state(false);
    let busy = $state(false);

    $effect(() => {
        if (initiallyEditing && !openedInitially) {
            openedInitially = true;
            expanded = true;
        }
    });

    async function update(changes: DeepPartial<ChatCommand>): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            await onUpdate(item.id, changes);
        } catch (error) {
            toast.error({ title: 'Command update failed', description: getErrorMessage(error) });
        } finally {
            busy = false;
        }
    }

    async function remove(): Promise<void> {
        if (busy) return;
        const confirmed = await appConfirm({
            title: 'Delete command?',
            description: `Delete "/${item.name}"?`,
            confirmText: 'Delete',
            variant: 'destructive'
        });
        if (!confirmed) return;
        busy = true;
        try {
            await onDelete(item.id);
        } catch (error) {
            toast.error({ title: 'Could not delete command', description: getErrorMessage(error) });
        } finally {
            busy = false;
        }
    }
</script>

<EditableListItem {expanded} {busy}>
    {#snippet header()}
        <div
            class="flex h-7 w-4 shrink-0 cursor-grab select-none items-center justify-center text-muted-foreground/45 transition-colors hover:text-muted-foreground active:cursor-grabbing"
            aria-hidden="true"
        >
            <GripVertical class="size-3.5" />
        </div>
        <button
            type="button"
            class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            onclick={() => (expanded = !expanded)}
            aria-label={expanded ? 'Collapse command' : 'Expand command'}
        >
            {#if expanded}<ChevronDown class="size-3.5" />{:else}<ChevronRight
                    class="size-3.5"
                />{/if}
        </button>
        <span class="flex min-w-0 flex-1 items-center gap-0.5">
            <span class="shrink-0 font-mono text-sm font-medium text-foreground">/</span>
            <Input
                value={item.name}
                disabled={busy}
                aria-label="Command name"
                class="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 font-mono font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
                onchange={(event) => update({ name: event.currentTarget.value })}
            />
        </span>
        <Button
            size="icon-sm"
            variant="ghost"
            class="text-muted-foreground hover:text-destructive"
            title="Delete command"
            aria-label="Delete command"
            onclick={remove}
        >
            <Trash2 class="size-3.5" />
        </Button>
    {/snippet}

    {#snippet details()}
        <div class="space-y-1.5">
            <Label class="text-xs">Description</Label>
            <Input
                value={item.description}
                disabled={busy}
                placeholder="Describe what this command does"
                onchange={(event) => update({ description: event.currentTarget.value })}
            />
        </div>
        <WorkflowSummaryCard
            wide
            workflow={item.workflow}
            workflowLabel={`/${item.name} Workflow`}
            onEditWorkflow={() => (workflowOpen = true)}
        />
    {/snippet}
</EditableListItem>

<WorkflowEditorModal
    bind:open={workflowOpen}
    workflow={item.workflow}
    title={`/${item.name} Workflow`}
    onPatch={(patch) => update({ workflow: patch })}
/>
