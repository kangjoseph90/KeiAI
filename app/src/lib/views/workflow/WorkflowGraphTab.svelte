<script lang="ts">
    import {
        Background,
        BackgroundVariant,
        Controls,
        MiniMap,
        SvelteFlow,
        type Connection,
        type Edge,
        type NodeTypes
    } from '@xyflow/svelte';
    import '@xyflow/svelte/dist/style.css';
    import {
        Bot,
        CheckCircle2,
        ChevronDown,
        ChevronRight,
        FileCode,
        GitFork,
        Hash,
        History,
        Layers,
        Plus,
        ToggleLeft,
        Trash2,
        TriangleAlert,
        Type,
        Variable as VariableIcon
    } from 'lucide-svelte';
    import { slide } from 'svelte/transition';
    import { SvelteSet } from 'svelte/reactivity';
    import { Button } from '$lib/components/ui/button';
    import { themePreference, t } from '$lib/stores';
    import { appConfirm } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';
    import {
        WORKFLOW_NODE_DEFINITIONS,
        WORKFLOW_NODE_CATEGORY_ORDER,
        connectNodes,
        createAgentInput,
        createNode,
        deleteAgentInput,
        deleteNode,
        disconnectNodeInput,
        renameAgentInput,
        updateNode,
        canConnectWorkflowNodes,
        validateWorkflow,
        type WorkflowDefinition,
        type WorkflowEditResult,
        type WorkflowNodeCategory,
        type WorkflowNodeChanges,
        type WorkflowNodeClass
    } from '$lib/workflow';
    import WorkflowNodeComponent, {
        type WorkflowCanvasNode,
        type WorkflowNodeData
    } from './nodes/WorkflowNode.svelte';

    interface Props {
        workflow: WorkflowDefinition;
        selectedNodeId: string | null;
        onSelectNode: (nodeId: string | null) => void;
        onEdit: (result: WorkflowEditResult) => void | Promise<void>;
        onEditAgent?: (nodeId: string) => void;
        title?: string;
        active?: boolean;
    }

    let {
        workflow,
        selectedNodeId,
        onSelectNode,
        onEdit,
        onEditAgent,
        title,
        active = true
    }: Props = $props();
    let nodes = $state.raw<WorkflowCanvasNode[]>([]);
    let edges = $state.raw<Edge[]>([]);

    const nodeTypes = { workflow: WorkflowNodeComponent } satisfies NodeTypes;
    const nodeDefinitionEntries = Object.entries(WORKFLOW_NODE_DEFINITIONS) as Array<
        [WorkflowNodeClass, (typeof WORKFLOW_NODE_DEFINITIONS)[WorkflowNodeClass]]
    >;
    const categoryLabelKeys = {
        agent: 'workflow.graph.category.agent',
        history: 'workflow.graph.category.history',
        string: 'workflow.graph.category.string',
        number: 'workflow.graph.category.number',
        boolean: 'workflow.graph.category.boolean',
        variable: 'workflow.graph.category.variable',
        flow: 'workflow.graph.category.flow',
        file: 'workflow.graph.category.file',
        result: 'workflow.graph.category.result'
    } as const satisfies Record<WorkflowNodeCategory, string>;
    const nodeLabelKeys = {
        String: 'workflow.graph.node.String',
        Number: 'workflow.graph.node.Number',
        Boolean: 'workflow.graph.node.Boolean',
        Template: 'workflow.graph.node.Template',
        GetToggle: 'workflow.graph.node.GetToggle',
        GetChatVar: 'workflow.graph.node.GetChatVar',
        SetChatVar: 'workflow.graph.node.SetChatVar',
        ToBoolean: 'workflow.graph.node.ToBoolean',
        ToNumber: 'workflow.graph.node.ToNumber',
        Catch: 'workflow.graph.node.Catch',
        ThrowIf: 'workflow.graph.node.ThrowIf',
        Concat: 'workflow.graph.node.Concat',
        StringLength: 'workflow.graph.node.StringLength',
        StringIncludes: 'workflow.graph.node.StringIncludes',
        StringReplace: 'workflow.graph.node.StringReplace',
        StringRegexReplace: 'workflow.graph.node.StringRegexReplace',
        FilterAgentParts: 'workflow.graph.node.FilterAgentParts',
        SelectVisibleParts: 'workflow.graph.node.SelectVisibleParts',
        SelectLastTextPart: 'workflow.graph.node.SelectLastTextPart',
        ImageGeneration: 'workflow.graph.node.ImageGeneration',
        TTS: 'workflow.graph.node.TTS',
        STT: 'workflow.graph.node.STT',
        GetHistory: 'workflow.graph.node.GetHistory',
        SetHistory: 'workflow.graph.node.SetHistory',
        GetImageAttachments: 'workflow.graph.node.GetImageAttachments',
        SetImageAttachments: 'workflow.graph.node.SetImageAttachments',
        GetAudioAttachments: 'workflow.graph.node.GetAudioAttachments',
        SetAudioAttachments: 'workflow.graph.node.SetAudioAttachments',
        GetTranslation: 'workflow.graph.node.GetTranslation',
        SetTranslation: 'workflow.graph.node.SetTranslation',
        NumberMath: 'workflow.graph.node.NumberMath',
        NumberCompare: 'workflow.graph.node.NumberCompare',
        BooleanLogic: 'workflow.graph.node.BooleanLogic',
        BooleanNot: 'workflow.graph.node.BooleanNot',
        Gate: 'workflow.graph.node.Gate',
        Ungate: 'workflow.graph.node.Ungate',
        Output: 'workflow.graph.node.Output',
        Log: 'workflow.graph.node.Log',
        Sink: 'workflow.graph.node.Sink',
        FileRead: 'workflow.graph.node.FileRead',
        FileWrite: 'workflow.graph.node.FileWrite',
        Agent: 'workflow.graph.node.Agent'
    } as const satisfies Record<WorkflowNodeClass, string>;
    const nodeGroups = $derived(
        WORKFLOW_NODE_CATEGORY_ORDER.map((category) => ({
            category,
            label: $t(categoryLabelKeys[category]),
            classes: nodeDefinitionEntries
                .filter(([, definition]) => definition.category === category)
                .map(([nodeClass]) => nodeClass)
        })).filter((group) => group.classes.length > 0)
    );
    const translatedNodeLabels = $derived(
        Object.fromEntries(
            nodeDefinitionEntries.map(([nodeClass]) => [nodeClass, $t(nodeLabelKeys[nodeClass])])
        ) as Record<WorkflowNodeClass, string>
    );

    const categoryMeta: Record<string, { icon: typeof Bot; color: string; bg: string }> = {
        agent: { icon: Bot, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/15' },
        history: { icon: History, color: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-500/15' },
        string: {
            icon: Type,
            color: 'text-emerald-600 dark:text-emerald-400',
            bg: 'bg-emerald-500/15'
        },
        number: { icon: Hash, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/15' },
        boolean: {
            icon: ToggleLeft,
            color: 'text-rose-600 dark:text-rose-400',
            bg: 'bg-rose-500/15'
        },
        variable: {
            icon: VariableIcon,
            color: 'text-indigo-600 dark:text-indigo-400',
            bg: 'bg-indigo-500/15'
        },
        flow: { icon: GitFork, color: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-500/15' },
        file: {
            icon: FileCode,
            color: 'text-slate-600 dark:text-slate-400',
            bg: 'bg-slate-500/15'
        },
        result: {
            icon: CheckCircle2,
            color: 'text-green-600 dark:text-green-400',
            bg: 'bg-green-500/15'
        }
    };

    const expandedGroups = new SvelteSet<WorkflowNodeCategory>(['agent']);
    let mobileNodePanelOpen = $state(false);

    function toggleGroup(category: WorkflowNodeCategory) {
        if (expandedGroups.has(category)) expandedGroups.delete(category);
        else expandedGroups.add(category);
    }

    interface WorkflowDiagnostic {
        message: string;
        nodeId?: string;
    }

    let diagnostics = $derived.by(() => collectDiagnostics(workflow));
    let selectedNode = $derived(selectedNodeId ? workflow.nodes[selectedNodeId] : undefined);

    $effect(() => {
        nodes = Object.values(workflow.nodes).map((node) => ({
            id: node.id,
            type: 'workflow',
            position: node.position,
            selected: node.id === selectedNodeId,
            data: {
                node,
                hasIssue: diagnostics.some((diagnostic) => diagnostic.nodeId === node.id),
                onAddSlot: addAgentSlot,
                onRenameSlot: renameAgentSlot,
                onDeleteSlot: deleteAgentSlot,
                onUpdateNode: editNode,
                onEditAgent
            } satisfies WorkflowNodeData
        }));
        edges = createEdges(workflow);
    });

    function addWorkflowNode(nodeClass: WorkflowNodeClass) {
        if (nodeClass === 'Output' && Object.values(workflow.nodes).some(isOutputNode)) return;
        const index = Object.keys(workflow.nodes).length;
        const result = createNode(workflow, nodeClass, {
            x: (index % 3) * 360,
            y: Math.floor(index / 3) * 480
        });
        onSelectNode(result.nodeId);
        return onEdit(result);
    }

    function addAgentSlot(nodeId: string) {
        const node = workflow.nodes[nodeId];
        if (!node || node.class !== 'Agent') return;
        let index = Object.keys(node.slotNames).length + 1;
        let name = `input${index}`;
        while (Object.values(node.slotNames).includes(name)) name = `input${++index}`;
        return onEdit(createAgentInput(workflow, nodeId, name));
    }

    function editNode(nodeId: string, changes: WorkflowNodeChanges) {
        return onEdit(updateNode(workflow, nodeId, changes));
    }

    function renameAgentSlot(nodeId: string, inputId: string, name: string) {
        return onEdit(renameAgentInput(workflow, nodeId, inputId, name));
    }

    function deleteAgentSlot(nodeId: string, inputId: string) {
        return onEdit(deleteAgentInput(workflow, nodeId, inputId));
    }

    $effect(() => {
        const handleKeydown = (event: KeyboardEvent) => {
            if (!active) return;
            if (event.key !== 'Delete') return;
            if (shouldIgnoreDeleteKey(event.target)) return;
            if (!selectedNode) return;

            event.preventDefault();
            void deleteSelectedNode();
        };

        window.addEventListener('keydown', handleKeydown);
        return () => window.removeEventListener('keydown', handleKeydown);
    });

    function handleConnect(connection: Connection) {
        if (!connection.source || !connection.target || !connection.targetHandle) return;
        const sourcePort = Number(connection.sourceHandle ?? 0);
        if (
            !canConnectWorkflowNodes(
                workflow,
                connection.target,
                connection.targetHandle,
                connection.source,
                sourcePort
            )
        ) {
            return;
        }
        return onEdit(
            connectNodes(
                workflow,
                connection.target,
                connection.targetHandle,
                connection.source,
                sourcePort
            )
        );
    }

    function isValidConnection(connection: Connection | Edge): boolean {
        if (!connection.source || !connection.target || !connection.targetHandle) return false;
        const sourcePort = Number(connection.sourceHandle ?? 0);
        return canConnectWorkflowNodes(
            workflow,
            connection.target,
            connection.targetHandle,
            connection.source,
            sourcePort
        );
    }

    function handleDelete(event: { nodes: WorkflowCanvasNode[]; edges: Edge[] }) {
        for (const edge of event.edges) {
            if (edge.targetHandle && workflow.nodes[edge.target]) {
                void onEdit(disconnectNodeInput(workflow, edge.target, edge.targetHandle));
            }
        }
        for (const node of event.nodes) {
            void deleteWorkflowNode(node.id);
        }
    }

    async function deleteSelectedNode() {
        if (!selectedNode) return;
        return deleteWorkflowNode(selectedNode.id);
    }

    async function deleteWorkflowNode(nodeId: string) {
        const node = workflow.nodes[nodeId];
        if (!node || node.class === 'Output') return;
        if (
            node.class === 'Agent' &&
            !(await appConfirm({
                title: $t('workflow.graph.deleteAgentTitle'),
                description: $t('workflow.graph.deleteAgentBody', { name: node.name }),
                confirmText: $t('common.actions.delete'),
                variant: 'destructive'
            }))
        ) {
            return;
        }

        const result = deleteNode(workflow, nodeId);
        onSelectNode(null);
        return onEdit(result);
    }

    function shouldIgnoreDeleteKey(target: EventTarget | null): boolean {
        if (!(target instanceof HTMLElement)) return false;
        return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'));
    }

    function createEdges(value: WorkflowDefinition): Edge[] {
        const result: Edge[] = [];
        for (const node of Object.values(value.nodes)) {
            for (const [inputId, connection] of Object.entries(node.inputs)) {
                if (!connection) continue;
                result.push({
                    id: `${connection.sourceNode}:${connection.sourcePort}->${node.id}:${inputId}`,
                    source: connection.sourceNode,
                    sourceHandle: String(connection.sourcePort),
                    target: node.id,
                    targetHandle: inputId,
                    type: 'smoothstep'
                });
            }
        }
        return result;
    }

    function collectDiagnostics(value: WorkflowDefinition): WorkflowDiagnostic[] {
        const result: WorkflowDiagnostic[] = [];

        for (const node of Object.values(value.nodes)) {
            const definition = WORKFLOW_NODE_DEFINITIONS[node.class];
            for (const [inputId, port] of Object.entries(definition.inputs)) {
                if (
                    port.required &&
                    !node.inputs[inputId] &&
                    (port.allowLiteral === false ||
                        !hasRequiredInputValue(node.inputValues[inputId]))
                ) {
                    result.push({
                        nodeId: node.id,
                        message: $t('workflow.graph.diagnosticRequired', {
                            node: node.name,
                            port: port.name
                        })
                    });
                }
            }
        }

        try {
            validateWorkflow(value);
        } catch (error) {
            const message = getErrorMessage(error, $t('workflow.graph.invalidWorkflow'));
            if (!result.some((diagnostic) => diagnostic.message === message)) {
                result.push({ message });
            }
        }

        return result;
    }

    function isOutputNode(node: WorkflowDefinition['nodes'][string]) {
        return node.class === 'Output';
    }

    function hasRequiredInputValue(value: unknown): boolean {
        return typeof value === 'string' ? value.trim().length > 0 : value !== undefined;
    }
</script>

{#snippet nodeAddList()}
    <div class="flex flex-col gap-1 pr-0.5">
        {#each nodeGroups as group (group.category)}
            {@const isExpanded = expandedGroups.has(group.category)}
            {@const meta = categoryMeta[group.category] ?? {
                icon: Layers,
                color: 'text-primary',
                bg: 'bg-primary/10'
            }}
            {@const GroupIcon = meta.icon}
            <div
                class="flex flex-col rounded-lg transition-colors {isExpanded ? 'bg-muted/40' : ''}"
            >
                <button
                    type="button"
                    class="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-semibold text-foreground/90 transition-colors hover:bg-muted/70"
                    onclick={() => toggleGroup(group.category)}
                    aria-expanded={isExpanded}
                >
                    <div class="flex min-w-0 items-center gap-2">
                        <div
                            class="flex size-5 shrink-0 items-center justify-center rounded-md {meta.bg} {meta.color}"
                        >
                            <GroupIcon class="size-3" />
                        </div>
                        <span class="truncate">{group.label}</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <span class="font-mono text-[10px] text-muted-foreground/60"
                            >{group.classes.length}</span
                        >
                        {#if isExpanded}
                            <ChevronDown class="size-3 text-muted-foreground" />
                        {:else}
                            <ChevronRight class="size-3 text-muted-foreground" />
                        {/if}
                    </div>
                </button>
                {#if isExpanded}
                    <div
                        transition:slide={{ duration: 150 }}
                        class="flex flex-col gap-0.5 px-1 pt-0.5 pb-1"
                    >
                        {#each group.classes as nodeClass (nodeClass)}
                            {@const disabled =
                                nodeClass === 'Output' &&
                                Object.values(workflow.nodes).some(isOutputNode)}
                            <button
                                type="button"
                                class="group/item flex items-center justify-between rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
                                {disabled}
                                onclick={() => addWorkflowNode(nodeClass)}
                            >
                                <span class="truncate">{translatedNodeLabels[nodeClass]}</span>
                                <Plus
                                    class="size-3 text-primary opacity-0 transition-opacity shrink-0 group-hover/item:opacity-100"
                                />
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
        {/each}
    </div>
{/snippet}

<div class="relative min-h-0 flex-1 overflow-hidden bg-muted/10">
    <!-- Desktop: left-top panel -->
    <div
        class="absolute left-3 top-3 z-10 hidden max-h-[calc(100%-2rem)] w-56 flex-col gap-1 overflow-y-auto rounded-xl border bg-background/95 p-1.5 shadow-md backdrop-blur md:flex"
    >
        {@render nodeAddList()}
    </div>

    {#if selectedNode}
        <div
            class="absolute right-3 top-3 z-10 flex h-8 max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-full border bg-background/90 px-3 text-xs font-medium shadow-xs backdrop-blur"
        >
            <span class="min-w-0 max-w-40 truncate">{selectedNode.name}</span>
            {#if selectedNode.class === 'Output'}
                <span class="font-mono text-[10px] text-muted-foreground"
                    >{$t('workflow.graph.required')}</span
                >
            {:else}
                <button
                    type="button"
                    class="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                    title={$t('workflow.graph.deleteSelected')}
                    aria-label={$t('workflow.graph.deleteSelected')}
                    onclick={deleteSelectedNode}
                >
                    <Trash2 class="size-3" />
                </button>
            {/if}
        </div>
    {/if}

    {#if Object.keys(workflow.nodes).length === 0}
        <div class="pointer-events-none absolute inset-0 z-1 flex items-center justify-center">
            <div
                class="pointer-events-auto flex flex-col items-center gap-3 rounded-xl border bg-background/90 p-6 text-center shadow-sm"
            >
                <p class="text-sm font-medium">{$t('workflow.graph.emptyTitle')}</p>
                <p class="max-w-64 text-xs text-muted-foreground">
                    {$t('workflow.graph.emptyBody')}
                </p>
                <Button size="sm" onclick={() => addWorkflowNode('Output')}
                    ><Plus class="size-3.5" /> {$t('workflow.graph.addOutput')}</Button
                >
            </div>
        </div>
    {/if}

    {#if diagnostics.length > 0}
        <div
            class="absolute bottom-16 left-1/2 z-10 flex max-w-[min(42rem,calc(100%-8rem))] -translate-x-1/2 items-start gap-2 rounded-lg border border-destructive/30 bg-background/95 px-3 py-2 text-xs shadow-sm backdrop-blur md:bottom-3"
        >
            <TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <div class="min-w-0">
                <p class="truncate text-destructive">{diagnostics[0].message}</p>
                {#if diagnostics.length > 1}
                    <p class="text-[10px] text-muted-foreground">
                        {$t('workflow.graph.moreIssues', { count: diagnostics.length - 1 })}
                    </p>
                {/if}
            </div>
        </div>
    {/if}

    <SvelteFlow
        colorMode={$themePreference}
        bind:nodes
        bind:edges
        {nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={2}
        {isValidConnection}
        onconnect={handleConnect}
        onnodeclick={({ node }) => onSelectNode(node.id)}
        onnodedragstart={({ targetNode }) => targetNode && onSelectNode(targetNode.id)}
        onpaneclick={() => onSelectNode(null)}
        onnodedragstop={({ targetNode }) => {
            if (targetNode)
                void onEdit(updateNode(workflow, targetNode.id, { position: targetNode.position }));
        }}
        ondelete={handleDelete}
    >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls />
        <MiniMap pannable zoomable />
    </SvelteFlow>

    <!-- Mobile: bottom sheet for node adding -->
    <div class="absolute inset-x-0 bottom-0 z-20 md:hidden">
        {#if mobileNodePanelOpen}
            <div
                transition:slide={{ duration: 150 }}
                class="flex max-h-[60vh] flex-col overflow-hidden rounded-t-xl border-x border-t bg-background/95 shadow-lg backdrop-blur"
            >
                <div class="flex shrink-0 items-center justify-between px-3 py-2">
                    <span class="text-xs font-semibold text-muted-foreground"
                        >{$t('workflow.graph.addNode')}</span
                    >
                    <button
                        type="button"
                        class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        onclick={() => (mobileNodePanelOpen = false)}
                        aria-label={$t('workflow.graph.closePanel')}
                    >
                        <ChevronDown class="size-4" />
                    </button>
                </div>
                <div class="min-h-0 overflow-y-auto px-2 pb-2">
                    {@render nodeAddList()}
                </div>
            </div>
        {:else}
            <button
                type="button"
                transition:slide={{ duration: 150 }}
                class="mx-auto mb-2 flex h-9 items-center gap-1.5 rounded-full border bg-background/95 px-4 text-xs font-medium shadow-sm backdrop-blur hover:bg-muted"
                onclick={() => (mobileNodePanelOpen = true)}
            >
                <Plus class="size-3.5" />
                {$t('workflow.graph.addNode')}
            </button>
        {/if}
    </div>
</div>

<style>
    @media (max-width: 767px) {
        :global(.svelte-flow__controls),
        :global(.svelte-flow__minimap) {
            display: none !important;
        }
    }
</style>
