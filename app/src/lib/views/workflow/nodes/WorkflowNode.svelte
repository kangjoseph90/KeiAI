<script module lang="ts">
    import type { Node, NodeProps } from '@xyflow/svelte';
    import type { WorkflowNode, WorkflowNodeChanges, WorkflowValue } from '$lib/workflow';

    export interface WorkflowNodeData extends Record<string, unknown> {
        node: WorkflowNode;
        hasIssue: boolean;
        onAddSlot: (nodeId: string) => void;
        onRenameSlot: (nodeId: string, inputId: string, name: string) => void;
        onDeleteSlot: (nodeId: string, inputId: string) => void;
        onUpdateNode: (nodeId: string, changes: WorkflowNodeChanges) => void;
        onEditAgent?: (nodeId: string) => void;
    }

    export type WorkflowCanvasNode = Node<WorkflowNodeData, 'workflow'>;
</script>

<script lang="ts">
    import { Handle, Position, useUpdateNodeInternals } from '@xyflow/svelte';
    import {
        AudioLines,
        Bot,
        Braces,
        Captions,
        CheckCircle2,
        ChevronDown,
        ChevronRight,
        ChevronUp,
        CircleDot,
        FileInput,
        FileOutput,
        FileText,
        GitBranch,
        GitMerge,
        Hash,
        History,
        ImageIcon,
        Images,
        Languages,
        Plus,
        ScrollText,
        TriangleAlert,
        Volume2
    } from 'lucide-svelte';
    import { WORKFLOW_NODE_DEFINITIONS, getWorkflowInputPortDefinition } from '$lib/workflow';
    import type { LLMType } from '$lib/types/models/llm';
    import type { WorkflowNodeCategory } from '$lib/workflow';
    import { listAgentTools } from '$lib/workflow/agent/tool';
    import OptionSelect from '$lib/components/OptionSelect.svelte';
    import WorkflowInputRow from './WorkflowInputRow.svelte';

    type AgentNumberField =
        | 'maxContext'
        | 'maxResponse'
        | 'lorebookRatio'
        | 'memoryRatio'
        | 'lorebookScanDepth';

    const CATEGORY_STYLES = {
        agent: {
            node: 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300',
            handle: '!bg-violet-500'
        },
        history: {
            node: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
            handle: '!bg-indigo-500'
        },
        string: {
            node: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
            handle: '!bg-sky-500'
        },
        number: {
            node: 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300',
            handle: '!bg-blue-500'
        },
        boolean: {
            node: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
            handle: '!bg-cyan-500'
        },
        variable: {
            node: 'border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300',
            handle: '!bg-orange-500'
        },
        flow: {
            node: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
            handle: '!bg-fuchsia-500'
        },
        file: {
            node: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
            handle: '!bg-amber-500'
        },
        result: {
            node: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
            handle: '!bg-emerald-500'
        }
    } satisfies Record<WorkflowNodeCategory, { node: string; handle: string }>;

    let { id, data, selected }: NodeProps<WorkflowCanvasNode> = $props();
    const updateNodeInternals = useUpdateNodeInternals();

    const definition = $derived(WORKFLOW_NODE_DEFINITIONS[data.node.class]);
    const inputEntries = $derived(Object.entries(data.node.inputs));
    const outputEntries = $derived(Object.entries(definition.outputs));
    const categoryStyle = $derived(CATEGORY_STYLES[definition.category]);
    const collapsed = $derived(data.node.collapsed);
    const agentTools = listAgentTools();
    const hasTopControls = $derived(
        [
            'Agent',
            'String',
            'Number',
            'Boolean',
            'NumberMath',
            'NumberCompare',
            'BooleanLogic',
            'StringIncludes',
            'FilterAgentParts',
            'FileRead',
            'FileWrite'
        ].includes(data.node.class)
    );
    let toolsExpanded = $state(false);
    const nodeInternalsVersion = $derived(
        `${Object.keys(data.node.inputs).join(',')}:${data.node.collapsed}`
    );

    $effect(() => {
        if (nodeInternalsVersion) updateNodeInternals(id);
    });

    function updateInputValue(inputId: string, value: WorkflowValue) {
        data.onUpdateNode(data.node.id, { inputValues: { [inputId]: value } });
    }

    function updateNumber(field: AgentNumberField, value: string) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            data.onUpdateNode(data.node.id, { [field]: parsed } as WorkflowNodeChanges);
        }
    }

    function updateAgentTool(toolId: string, enabled: boolean) {
        if (data.node.class !== 'Agent') return;
        const current = data.node.toolIds;
        const toolIds = enabled
            ? current.includes(toolId)
                ? current
                : [...current, toolId]
            : current.filter((id) => id !== toolId);
        data.onUpdateNode(data.node.id, { toolIds });
    }
</script>

<div
    class="w-72 rounded-xl border bg-card text-card-foreground shadow-md transition-[border-color,box-shadow] {selected
        ? 'border-primary ring-2 ring-primary/20'
        : 'border-border/80'} {data.hasIssue ? 'ring-2 ring-destructive/30' : ''}"
>
    <div
        class="workflow-node-drag-handle relative flex cursor-grab items-center gap-2 px-3 py-2 active:cursor-grabbing {collapsed
            ? 'rounded-xl'
            : 'rounded-t-xl border-b'} {categoryStyle.node}"
    >
        {#if collapsed}
            {#each inputEntries as [inputId] (inputId)}
                <Handle
                    type="target"
                    id={inputId}
                    position={Position.Left}
                    class="!left-0 !top-1/2 !size-3 !border-2 !border-card !bg-muted-foreground"
                />
            {/each}
            {#each outputEntries as [outputId] (outputId)}
                <Handle
                    type="source"
                    id={outputId}
                    position={Position.Right}
                    class="!right-0 !top-1/2 !size-3 !border-2 !border-card {categoryStyle.handle}"
                />
            {/each}
        {/if}
        <div class="flex size-7 shrink-0 items-center justify-center rounded-md bg-background/70">
            {#if data.node.class === 'Agent'}
                <Bot class="size-4" />
            {:else if data.node.class === 'ImageGeneration'}
                <ImageIcon class="size-4" />
            {:else if data.node.class === 'TTS'}
                <AudioLines class="size-4" />
            {:else if data.node.class === 'STT'}
                <Captions class="size-4" />
            {:else if data.node.class === 'GetHistory' || data.node.class === 'SetHistory'}
                <History class="size-4" />
            {:else if data.node.class === 'GetImageAttachments' || data.node.class === 'SetImageAttachments'}
                <Images class="size-4" />
            {:else if data.node.class === 'GetAudioAttachments' || data.node.class === 'SetAudioAttachments'}
                <Volume2 class="size-4" />
            {:else if data.node.class === 'GetTranslation' || data.node.class === 'SetTranslation'}
                <Languages class="size-4" />
            {:else if data.node.class === 'String'}
                <Braces class="size-4" />
            {:else if definition.category === 'number'}
                <Hash class="size-4" />
            {:else if definition.category === 'boolean'}
                <CircleDot class="size-4" />
            {:else if definition.category === 'string'}
                <GitMerge class="size-4" />
            {:else if definition.category === 'flow'}
                <GitBranch class="size-4" />
            {:else if data.node.class === 'FileRead'}
                <FileInput class="size-4" />
            {:else if data.node.class === 'FileWrite'}
                <FileOutput class="size-4" />
            {:else if data.node.class === 'Log'}
                <ScrollText class="size-4" />
            {:else if definition.category === 'variable'}
                <Braces class="size-4" />
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
        {#if data.node.class === 'Agent' && data.onEditAgent}
            <button
                type="button"
                class="nodrag flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-background/70"
                title="Edit agent"
                aria-label="Edit agent"
                onclick={() => data.onEditAgent?.(data.node.id)}
            >
                <FileText class="size-4" />
            </button>
        {/if}
        {#if data.hasIssue}<TriangleAlert class="size-4 shrink-0 text-destructive" />{/if}
        <button
            type="button"
            class="nodrag flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-background/70"
            title={collapsed ? 'Expand node' : 'Collapse node'}
            aria-label={collapsed ? 'Expand node' : 'Collapse node'}
            onclick={() => data.onUpdateNode(data.node.id, { collapsed: !collapsed })}
        >
            {#if collapsed}
                <ChevronRight class="size-4" />
            {:else}
                <ChevronDown class="size-4" />
            {/if}
        </button>
    </div>

    {#if !collapsed}
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
                            onchange={(event) =>
                                updateNumber('maxContext', event.currentTarget.value)}
                        />
                    </label>
                    <label class="flex flex-col gap-1 text-muted-foreground">
                        Max Response
                        <input
                            type="number"
                            class="nodrag h-7 rounded-md border bg-background px-2 text-xs text-foreground"
                            value={data.node.maxResponse}
                            onchange={(event) =>
                                updateNumber('maxResponse', event.currentTarget.value)}
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
                            onchange={(event) =>
                                updateNumber('memoryRatio', event.currentTarget.value)}
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
                    <div class="col-span-2 space-y-1.5">
                        <button
                            type="button"
                            class="nodrag flex h-8 w-full items-center justify-between rounded-md px-2 text-xs text-muted-foreground hover:bg-muted/50"
                            onclick={() => (toolsExpanded = !toolsExpanded)}
                        >
                            <span>Tools</span>
                            {#if toolsExpanded}
                                <ChevronUp class="size-3" />
                            {:else}
                                <ChevronDown class="size-3" />
                            {/if}
                        </button>
                        {#if toolsExpanded}
                            <div class="grid gap-4 rounded-lg border bg-muted/30 p-4">
                                <div class="flex flex-wrap gap-x-5 gap-y-2">
                                    {#each agentTools as tool (tool.id)}
                                        <label class="nodrag flex items-center gap-2 text-xs">
                                            <input
                                                type="checkbox"
                                                class="size-4 accent-primary"
                                                checked={data.node.toolIds.includes(tool.id)}
                                                onchange={(event) =>
                                                    updateAgentTool(
                                                        tool.id,
                                                        event.currentTarget.checked
                                                    )}
                                            />
                                            {tool.label}
                                        </label>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>
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
            {:else if data.node.class === 'Number'}
                <label class="flex flex-col gap-1 text-[10px] text-muted-foreground">
                    Value
                    <input
                        type="number"
                        class="nodrag h-7 rounded-md border bg-background px-2 text-xs text-foreground"
                        value={data.node.value}
                        onchange={(event) =>
                            data.onUpdateNode(data.node.id, {
                                value: Number(event.currentTarget.value)
                            })}
                    />
                </label>
            {:else if data.node.class === 'Boolean'}
                <label
                    class="flex items-center justify-between gap-2 rounded-md border bg-background px-2 py-1.5 text-xs text-muted-foreground"
                >
                    Value
                    <input
                        type="checkbox"
                        class="nodrag size-4"
                        checked={data.node.value}
                        onchange={(event) =>
                            data.onUpdateNode(data.node.id, {
                                value: event.currentTarget.checked
                            })}
                    />
                </label>
            {:else if data.node.class === 'NumberMath'}
                <label class="flex flex-col gap-1 text-[10px] text-muted-foreground">
                    Operator
                    <OptionSelect
                        id={`workflow-node-${data.node.id}-number-math-operator`}
                        class="nodrag h-7 rounded-md border bg-background px-2 text-xs text-foreground"
                        value={data.node.operator}
                        options={[
                            { value: 'add', label: 'add' },
                            { value: 'subtract', label: 'subtract' },
                            { value: 'multiply', label: 'multiply' },
                            { value: 'divide', label: 'divide' }
                        ]}
                        onChange={(value) =>
                            data.onUpdateNode(data.node.id, {
                                operator: value as typeof data.node.operator
                            })}
                    />
                </label>
            {:else if data.node.class === 'NumberCompare'}
                <label class="flex flex-col gap-1 text-[10px] text-muted-foreground">
                    Operator
                    <OptionSelect
                        id={`workflow-node-${data.node.id}-number-compare-operator`}
                        class="nodrag h-7 rounded-md border bg-background px-2 text-xs text-foreground"
                        value={data.node.operator}
                        options={[
                            { value: 'equal', label: 'equal' },
                            { value: 'notEqual', label: 'not equal' },
                            { value: 'greaterThan', label: 'greater than' },
                            { value: 'greaterThanOrEqual', label: 'greater than or equal' },
                            { value: 'lessThan', label: 'less than' },
                            { value: 'lessThanOrEqual', label: 'less than or equal' }
                        ]}
                        onChange={(value) =>
                            data.onUpdateNode(data.node.id, {
                                operator: value as typeof data.node.operator
                            })}
                    />
                </label>
            {:else if data.node.class === 'BooleanLogic'}
                <label class="flex flex-col gap-1 text-[10px] text-muted-foreground">
                    Operator
                    <OptionSelect
                        id={`workflow-node-${data.node.id}-boolean-logic-operator`}
                        class="nodrag h-7 rounded-md border bg-background px-2 text-xs text-foreground"
                        value={data.node.operator}
                        options={[
                            { value: 'and', label: 'and' },
                            { value: 'or', label: 'or' },
                            { value: 'xor', label: 'xor' },
                            { value: 'nand', label: 'nand' },
                            { value: 'nor', label: 'nor' },
                            { value: 'xnor', label: 'xnor' }
                        ]}
                        onChange={(value) =>
                            data.onUpdateNode(data.node.id, {
                                operator: value as typeof data.node.operator
                            })}
                    />
                </label>
            {:else if data.node.class === 'StringIncludes'}
                <label
                    class="flex items-center justify-between gap-2 rounded-md border bg-background px-2 py-1.5 text-xs text-muted-foreground"
                >
                    Case sensitive
                    <input
                        type="checkbox"
                        class="nodrag size-4"
                        checked={data.node.caseSensitive}
                        onchange={(event) =>
                            data.onUpdateNode(data.node.id, {
                                caseSensitive: event.currentTarget.checked
                            })}
                    />
                </label>
            {:else if data.node.class === 'FilterAgentParts'}
                <div class="grid grid-cols-2 gap-2 rounded-md border bg-background p-2">
                    <label class="nodrag flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                            type="checkbox"
                            class="size-4"
                            checked={data.node.includeText}
                            onchange={(event) =>
                                data.onUpdateNode(data.node.id, {
                                    includeText: event.currentTarget.checked
                                })}
                        />
                        Text
                    </label>
                    <label class="nodrag flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                            type="checkbox"
                            class="size-4"
                            checked={data.node.includeThought}
                            onchange={(event) =>
                                data.onUpdateNode(data.node.id, {
                                    includeThought: event.currentTarget.checked
                                })}
                        />
                        Thought
                    </label>
                    <label class="nodrag flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                            type="checkbox"
                            class="size-4"
                            checked={data.node.includeInlay}
                            onchange={(event) =>
                                data.onUpdateNode(data.node.id, {
                                    includeInlay: event.currentTarget.checked
                                })}
                        />
                        Inlay
                    </label>
                    <label class="nodrag flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                            type="checkbox"
                            class="size-4"
                            checked={data.node.includeToolCalls}
                            onchange={(event) =>
                                data.onUpdateNode(data.node.id, {
                                    includeToolCalls: event.currentTarget.checked
                                })}
                        />
                        Tool calls
                    </label>
                </div>
            {:else if data.node.class === 'FileRead' || data.node.class === 'FileWrite'}
                <label class="flex flex-col gap-1 text-[10px] text-muted-foreground">
                    Namespace
                    <OptionSelect
                        id={`workflow-node-${data.node.id}-namespace`}
                        class="nodrag h-7 rounded-md border bg-background px-2 text-xs text-foreground"
                        value={data.node.namespace}
                        options={[
                            { value: 'global', label: 'global' },
                            { value: 'room', label: 'room' },
                            { value: 'chat', label: 'chat' }
                        ]}
                        onChange={(value) =>
                            data.onUpdateNode(data.node.id, {
                                namespace: value as 'global' | 'room' | 'chat'
                            })}
                    />
                </label>
            {/if}

            {#if inputEntries.length > 0}
                <div class="flex flex-col gap-2 {hasTopControls ? 'border-t pt-2' : ''}">
                    {#each inputEntries as [inputId, connection] (inputId)}
                        {@const port = getWorkflowInputPortDefinition(data.node, inputId)}
                        {@const hasLiteral = inputId in data.node.inputValues}
                        <WorkflowInputRow
                            node={data.node}
                            {inputId}
                            {connection}
                            {port}
                            {hasLiteral}
                            onUpdateInputValue={updateInputValue}
                            onRenameSlot={data.onRenameSlot}
                            onDeleteSlot={data.onDeleteSlot}
                        />
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
                            <span class="ml-1 text-[9px] text-muted-foreground/50">{port.type}</span
                            >
                            <Handle
                                type="source"
                                id={outputId}
                                position={Position.Right}
                                class="!right-0 !size-3 !border-2 !border-card {categoryStyle.handle}"
                            />
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}
</div>
