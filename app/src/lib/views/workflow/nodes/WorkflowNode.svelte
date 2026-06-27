<script module lang="ts">
    import type { Node, NodeProps } from '@xyflow/svelte';
    import type { WorkflowNode, WorkflowNodeChanges } from '$lib/workflow';

    export interface WorkflowNodeData extends Record<string, unknown> {
        node: WorkflowNode;
        hasIssue: boolean;
        onEditPrompt: (nodeId: string) => void;
        onAddSlot: (nodeId: string) => void;
        onRenameSlot: (nodeId: string, inputId: string, name: string) => void;
        onDeleteSlot: (nodeId: string, inputId: string) => void;
        onUpdateNode: (nodeId: string, changes: WorkflowNodeChanges) => void;
    }

    export type WorkflowCanvasNode = Node<WorkflowNodeData, 'workflow'>;
</script>

<script lang="ts">
    import { Handle, Position, useUpdateNodeInternals } from '@xyflow/svelte';
    import {
        Bot,
        Braces,
        CheckCircle2,
        FileInput,
        FileOutput,
        GitMerge,
        Plus,
        Settings2,
        TriangleAlert,
        X
    } from 'lucide-svelte';
    import { WORKFLOW_NODE_DEFINITIONS } from '$lib/workflow';
    import type { LLMType } from '$lib/types/models/llm';

    type AgentNumberField =
        | 'maxContext'
        | 'maxResponse'
        | 'lorebookRatio'
        | 'memoryRatio'
        | 'lorebookScanDepth';

    let { id, data, selected }: NodeProps<WorkflowCanvasNode> = $props();
    const updateNodeInternals = useUpdateNodeInternals();

    const definition = $derived(WORKFLOW_NODE_DEFINITIONS[data.node.class]);
    const inputEntries = $derived(Object.entries(data.node.inputs));
    const outputEntries = $derived(Object.entries(definition.outputs));

    $effect(() => {
        Object.keys(data.node.inputs);
        updateNodeInternals(id);
    });

    function updateInputValue(inputId: string, value: string) {
        data.onUpdateNode(data.node.id, { inputValues: { [inputId]: value } });
    }

    function updateNumber(field: AgentNumberField, value: string) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            data.onUpdateNode(data.node.id, { [field]: parsed } as WorkflowNodeChanges);
        }
    }

    function categoryClasses() {
        switch (definition.category) {
            case 'agent':
                return 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300';
            case 'operator':
                return 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300';
            case 'file':
                return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300';
            case 'output':
                return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
        }
    }

    function handleClasses() {
        switch (definition.category) {
            case 'agent':
                return '!bg-violet-500';
            case 'operator':
                return '!bg-sky-500';
            case 'file':
                return '!bg-amber-500';
            case 'output':
                return '!bg-emerald-500';
        }
    }
</script>

<div
    class="w-72 rounded-xl border bg-card text-card-foreground shadow-md transition-[border-color,box-shadow] {selected
        ? 'border-primary ring-2 ring-primary/20'
        : 'border-border/80'} {data.hasIssue ? 'ring-2 ring-destructive/30' : ''}"
>
    <div
        class="workflow-node-drag-handle flex cursor-grab items-center gap-2 rounded-t-xl border-b px-3 py-2 active:cursor-grabbing {categoryClasses()}"
    >
        <div class="flex size-7 shrink-0 items-center justify-center rounded-md bg-background/70">
            {#if data.node.class === 'Agent'}
                <Bot class="size-4" />
            {:else if data.node.class === 'String'}
                <Braces class="size-4" />
            {:else if data.node.class === 'Concat'}
                <GitMerge class="size-4" />
            {:else if data.node.class === 'FileRead'}
                <FileInput class="size-4" />
            {:else if data.node.class === 'FileWrite'}
                <FileOutput class="size-4" />
            {:else}
                <CheckCircle2 class="size-4" />
            {/if}
        </div>
        <input
            class="nodrag min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-current/50"
            value={data.node.name}
            aria-label="Node name"
            onchange={(event) =>
                data.onUpdateNode(data.node.id, { name: event.currentTarget.value })}
        />
        {#if data.hasIssue}<TriangleAlert class="size-4 shrink-0 text-destructive" />{/if}
    </div>

    <div class="flex flex-col gap-3 p-3">
        {#if data.node.class === 'Agent'}
            <div class="grid grid-cols-2 gap-2 text-[10px]">
                <label class="col-span-2 flex flex-col gap-1 text-muted-foreground">
                    LLM Type
                    <input
                        class="nodrag h-7 rounded-md border bg-background px-2 text-xs text-foreground"
                        value={data.node.llmType}
                        onchange={(event) =>
                            data.onUpdateNode(data.node.id, {
                                llmType: event.currentTarget.value as LLMType
                            })}
                    />
                </label>
                <label class="flex flex-col gap-1 text-muted-foreground">
                    Max Context
                    <input
                        type="number"
                        class="nodrag h-7 rounded-md border bg-background px-2 text-xs text-foreground"
                        value={data.node.maxContext}
                        onchange={(event) => updateNumber('maxContext', event.currentTarget.value)}
                    />
                </label>
                <label class="flex flex-col gap-1 text-muted-foreground">
                    Max Response
                    <input
                        type="number"
                        class="nodrag h-7 rounded-md border bg-background px-2 text-xs text-foreground"
                        value={data.node.maxResponse}
                        onchange={(event) => updateNumber('maxResponse', event.currentTarget.value)}
                    />
                </label>
                <label class="flex flex-col gap-1 text-muted-foreground">
                    Lorebook Ratio
                    <input
                        type="number"
                        step="0.05"
                        class="nodrag h-7 rounded-md border bg-background px-2 text-xs text-foreground"
                        value={data.node.lorebookRatio}
                        onchange={(event) =>
                            updateNumber('lorebookRatio', event.currentTarget.value)}
                    />
                </label>
                <label class="flex flex-col gap-1 text-muted-foreground">
                    Memory Ratio
                    <input
                        type="number"
                        step="0.05"
                        class="nodrag h-7 rounded-md border bg-background px-2 text-xs text-foreground"
                        value={data.node.memoryRatio}
                        onchange={(event) => updateNumber('memoryRatio', event.currentTarget.value)}
                    />
                </label>
                <label class="col-span-2 flex flex-col gap-1 text-muted-foreground">
                    Lorebook Scan Depth
                    <input
                        type="number"
                        class="nodrag h-7 rounded-md border bg-background px-2 text-xs text-foreground"
                        value={data.node.lorebookScanDepth}
                        onchange={(event) =>
                            updateNumber('lorebookScanDepth', event.currentTarget.value)}
                    />
                </label>
            </div>
            <button
                class="nodrag flex h-8 items-center justify-center gap-1.5 rounded-md border bg-background text-xs font-medium hover:bg-muted"
                onclick={() => data.onEditPrompt(data.node.id)}
            >
                <Settings2 class="size-3.5" /> Edit prompt · {Object.keys(data.node.promptBlocks)
                    .length} blocks
            </button>
        {:else if data.node.class === 'String'}
            <label class="flex flex-col gap-1 text-[10px] text-muted-foreground">
                Content
                <textarea
                    class="nodrag min-h-20 resize-y rounded-md border bg-background p-2 text-xs leading-relaxed text-foreground"
                    value={data.node.content}
                    placeholder="Enter text..."
                    onchange={(event) =>
                        data.onUpdateNode(data.node.id, { content: event.currentTarget.value })}
                ></textarea>
            </label>
        {:else if data.node.class === 'FileRead' || data.node.class === 'FileWrite'}
            <label class="flex flex-col gap-1 text-[10px] text-muted-foreground">
                Namespace
                <select
                    class="nodrag h-7 rounded-md border bg-background px-2 text-xs text-foreground"
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
        {:else if data.node.class === 'Output'}
            <p class="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                Publishes the workflow's final string result.
            </p>
        {/if}

        {#if inputEntries.length > 0}
            <div class="flex flex-col gap-2 border-t pt-2">
                <p class="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70">
                    Inputs
                </p>
                {#each inputEntries as [inputId, connection] (inputId)}
                    {@const port = definition.inputs[inputId]}
                    {@const hasLiteral = inputId in data.node.inputValues}
                    <div class="relative -mx-3 flex min-h-7 items-center gap-2 px-3 text-xs">
                        <Handle
                            type="target"
                            id={inputId}
                            position={Position.Left}
                            class="!left-0 !size-3 !border-2 !border-card {connection
                                ? '!bg-primary'
                                : '!bg-muted-foreground'}"
                        />
                        {#if data.node.class === 'Agent'}
                            <input
                                class="nodrag w-20 shrink-0 bg-transparent text-xs text-muted-foreground outline-none"
                                value={data.node.slotNames[inputId]}
                                aria-label="Input name"
                                onchange={(event) =>
                                    data.onRenameSlot(
                                        data.node.id,
                                        inputId,
                                        event.currentTarget.value
                                    )}
                            />
                        {:else}
                            <span class="w-16 shrink-0 truncate text-muted-foreground">
                                {port?.name ?? inputId}{#if port?.required}<span
                                        class="text-destructive">*</span
                                    >{/if}
                            </span>
                        {/if}
                        {#if hasLiteral}
                            <input
                                class="nodrag h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs text-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                                value={data.node.inputValues[inputId]}
                                disabled={connection !== null}
                                placeholder={connection ? 'Connected' : 'String'}
                                onchange={(event) =>
                                    updateInputValue(inputId, event.currentTarget.value)}
                            />
                        {:else}
                            <span
                                class="min-w-0 flex-1 text-right text-[9px] text-muted-foreground/60"
                            >
                                {connection ? 'linked' : 'string'}
                            </span>
                        {/if}
                        {#if data.node.class === 'Agent'}
                            <button
                                class="nodrag -mr-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                                title="Delete input"
                                onclick={() => data.onDeleteSlot(data.node.id, inputId)}
                                ><X class="size-3" /></button
                            >
                        {/if}
                    </div>
                {/each}
                {#if data.node.class === 'Agent'}
                    <button
                        class="nodrag flex h-6 items-center gap-1 self-start rounded px-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                        onclick={() => data.onAddSlot(data.node.id)}
                        ><Plus class="size-3" /> Add input</button
                    >
                {/if}
            </div>
        {:else if data.node.class === 'Agent'}
            <button
                class="nodrag flex h-7 items-center gap-1 self-start rounded px-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                onclick={() => data.onAddSlot(data.node.id)}
                ><Plus class="size-3" /> Add input</button
            >
        {/if}

        {#if outputEntries.length > 0}
            <div class="flex flex-col gap-1.5 border-t pt-2">
                {#each outputEntries as [outputId, port] (outputId)}
                    <div class="relative -mx-3 flex h-6 items-center justify-end px-3 text-xs">
                        <span class="text-muted-foreground">{port.name}</span>
                        <Handle
                            type="source"
                            id={outputId}
                            position={Position.Right}
                            class="!right-0 !size-3 !border-2 !border-card {handleClasses()}"
                        />
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</div>
