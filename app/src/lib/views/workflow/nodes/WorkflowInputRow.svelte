<script lang="ts">
    import { Handle, Position } from '@xyflow/svelte';
    import { X } from 'lucide-svelte';
    import type {
        InputPort,
        WorkflowNode,
        WorkflowPortDefinition,
        WorkflowValue
    } from '$lib/workflow';

    interface Props {
        node: WorkflowNode;
        inputId: string;
        connection: InputPort;
        port?: WorkflowPortDefinition;
        hasLiteral: boolean;
        onUpdateInputValue: (inputId: string, value: WorkflowValue) => void;
        onRenameSlot: (nodeId: string, inputId: string, name: string) => void;
        onDeleteSlot: (nodeId: string, inputId: string) => void;
    }

    let {
        node,
        inputId,
        connection,
        port,
        hasLiteral,
        onUpdateInputValue,
        onRenameSlot,
        onDeleteSlot
    }: Props = $props();

    function inputValueAsString(): string {
        return String(node.inputValues[inputId] ?? '');
    }

    function inputValueAsNumber(): number {
        const value = node.inputValues[inputId];
        return typeof value === 'number' ? value : 0;
    }

    function inputValueAsBoolean(): boolean {
        return node.inputValues[inputId] === true;
    }
</script>

<div class="relative -mx-3 flex min-h-7 items-center gap-2 px-3 text-xs">
    <Handle
        type="target"
        id={inputId}
        position={Position.Left}
        class="!left-0 !size-3 !border-2 !border-card {connection
            ? '!bg-primary'
            : '!bg-muted-foreground'}"
    />
    {#if node.class === 'Agent'}
        <input
            class="nodrag w-20 shrink-0 bg-transparent text-xs text-muted-foreground outline-none"
            value={node.slotNames[inputId]}
            aria-label="Input name"
            onchange={(event) => onRenameSlot(node.id, inputId, event.currentTarget.value)}
        />
    {:else}
        <span class="w-16 shrink-0 truncate text-muted-foreground">
            {port?.name ?? inputId}{#if port?.required}<span class="text-destructive">*</span>{/if}
        </span>
    {/if}

    {#if hasLiteral}
        {#if port?.type === 'boolean'}
            <label
                class="nodrag flex h-7 min-w-0 flex-1 items-center justify-between rounded-md border bg-background px-2 text-[10px] text-muted-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:bg-muted"
            >
                {connection ? 'Connected' : 'Value'}
                <input
                    type="checkbox"
                    class="size-3.5 disabled:cursor-not-allowed"
                    checked={inputValueAsBoolean()}
                    disabled={connection !== null}
                    onchange={(event) => onUpdateInputValue(inputId, event.currentTarget.checked)}
                />
            </label>
        {:else if port?.type === 'number'}
            <input
                type="number"
                class="nodrag h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs text-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                value={inputValueAsNumber()}
                disabled={connection !== null}
                placeholder={connection ? 'Connected' : 'Number'}
                onchange={(event) => onUpdateInputValue(inputId, Number(event.currentTarget.value))}
            />
        {:else}
            <input
                class="nodrag h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs text-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                value={inputValueAsString()}
                disabled={connection !== null}
                placeholder={connection ? 'Connected' : 'String'}
                onchange={(event) => onUpdateInputValue(inputId, event.currentTarget.value)}
            />
        {/if}
    {:else}
        <span class="min-w-0 flex-1 text-right text-[9px] text-muted-foreground/60">
            {connection ? 'linked' : (port?.type ?? 'string')}
        </span>
    {/if}

    {#if node.class === 'Agent'}
        <button
            class="nodrag -mr-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
            title="Delete input"
            onclick={() => onDeleteSlot(node.id, inputId)}><X class="size-3" /></button
        >
    {/if}
</div>
