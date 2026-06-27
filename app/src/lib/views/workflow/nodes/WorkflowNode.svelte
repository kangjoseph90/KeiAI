<script lang="ts" module>
    import type { Node } from '@xyflow/svelte';
    import type { WorkflowNode, WorkflowNodeChanges } from '$lib/workflow';

    export interface WorkflowNodeData extends Record<string, unknown> {
        node: WorkflowNode;
        onEditPrompt: (nodeId: string) => void;
        onAddSlot: (nodeId: string) => void;
        onUpdateNode: (nodeId: string, changes: WorkflowNodeChanges) => void;
    }

    export type WorkflowCanvasNode = Node<WorkflowNodeData, 'workflow'>;
</script>

<script lang="ts">
    import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/svelte';
    import { Plus, Settings2 } from 'lucide-svelte';
    import { WORKFLOW_NODE_DEFINITIONS } from '$lib/workflow';

    let { id, data, selected }: NodeProps<WorkflowCanvasNode> = $props();
    const updateNodeInternals = useUpdateNodeInternals();

    $effect(() => {
        Object.keys(data.node.inputs);
        updateNodeInternals(id);
    });
</script>

<div
    class="min-w-52 rounded-lg border bg-card text-card-foreground shadow-sm {selected
        ? 'border-primary ring-1 ring-primary'
        : ''}"
>
    <div class="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div class="min-w-0">
            <p class="truncate text-sm font-semibold">{data.node.name}</p>
            <p class="text-[10px] uppercase tracking-wide text-muted-foreground">
                {data.node.class}
            </p>
        </div>
        {#if data.node.class === 'Agent'}
            <button
                class="nodrag rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onclick={() => data.onEditPrompt(data.node.id)}
                title="Edit prompt"><Settings2 class="size-4" /></button
            >
        {/if}
    </div>

    <div class="flex min-h-12 flex-col gap-1.5 p-3">
        {#if data.node.class === 'FileRead' || data.node.class === 'FileWrite'}
            <label class="nodrag flex flex-col gap-1 text-[10px] text-muted-foreground">
                Namespace
                <select
                    class="h-7 rounded border bg-background px-2 text-xs text-foreground"
                    value={data.node.namespace}
                    onchange={(event) =>
                        data.onUpdateNode(data.node.id, {
                            namespace: event.currentTarget.value as 'global' | 'room' | 'chat'
                        })}
                >
                    <option value="global">global</option>
                    <option value="room">room</option>
                    <option value="chat">chat</option>
                </select>
            </label>
            <label class="nodrag mb-2 flex flex-col gap-1 text-[10px] text-muted-foreground">
                Path
                <input
                    class="h-7 rounded border bg-background px-2 text-xs text-foreground"
                    value={data.node.path}
                    placeholder="path/to/file.txt"
                    onchange={(event) =>
                        data.onUpdateNode(data.node.id, { path: event.currentTarget.value })}
                />
            </label>
        {/if}

        {#each Object.keys(data.node.inputs) as inputId (inputId)}
            <div class="relative flex h-5 items-center text-xs text-muted-foreground">
                <Handle
                    type="target"
                    id={inputId}
                    position={Position.Left}
                    class="!size-2.5 !border-2 !border-background !bg-muted-foreground"
                />
                <span class="truncate pl-1">
                    {data.node.class === 'Agent' ? data.node.slotNames[inputId] : inputId}
                </span>
            </div>
        {/each}

        {#if data.node.class === 'Agent'}
            <button
                class="nodrag mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onclick={() => data.onAddSlot(data.node.id)}><Plus class="size-3" /> Input</button
            >
        {/if}
    </div>

    {#each Object.keys(WORKFLOW_NODE_DEFINITIONS[data.node.class].outputs) as outputId (outputId)}
        <Handle
            type="source"
            id={outputId}
            position={Position.Right}
            class="!size-3 !border-2 !border-background !bg-primary"
        />
    {/each}
</div>
