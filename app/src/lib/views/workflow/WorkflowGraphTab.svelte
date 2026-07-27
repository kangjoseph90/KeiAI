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
    import { ChevronDown, ChevronRight, Plus, Trash2, TriangleAlert } from 'lucide-svelte';
    import { SvelteSet } from 'svelte/reactivity';
    import { Button } from '$lib/components/ui/button';
    import { appConfirm } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';
    import {
        WORKFLOW_NODE_DEFINITIONS,
        WORKFLOW_NODE_CATEGORY_LABELS,
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
        onEditPrompt?: (nodeId: string) => void;
        title?: string;
    }

    let { workflow, selectedNodeId, onSelectNode, onEdit, onEditPrompt, title }: Props = $props();
    let nodes = $state.raw<WorkflowCanvasNode[]>([]);
    let edges = $state.raw<Edge[]>([]);

    const nodeTypes = { workflow: WorkflowNodeComponent } satisfies NodeTypes;
    const nodeDefinitionEntries = Object.entries(WORKFLOW_NODE_DEFINITIONS) as Array<
        [WorkflowNodeClass, (typeof WORKFLOW_NODE_DEFINITIONS)[WorkflowNodeClass]]
    >;
    const nodeGroups = WORKFLOW_NODE_CATEGORY_ORDER.map((category) => ({
        label: WORKFLOW_NODE_CATEGORY_LABELS[category],
        classes: nodeDefinitionEntries
            .filter(([, definition]) => definition.category === category)
            .map(([nodeClass]) => nodeClass)
    })).filter((group) => group.classes.length > 0);

    const expandedGroups = new SvelteSet<string>();
    let mobileNodePanelOpen = $state(false);

    function toggleGroup(label: string) {
        if (expandedGroups.has(label)) expandedGroups.delete(label);
        else expandedGroups.add(label);
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
                onEditPrompt
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
                title: 'Delete agent node?',
                description: `Delete agent node "${node.name}"?`,
                confirmText: 'Delete',
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
                        message: `${node.name}: ${port.name} input is required`
                    });
                }
            }
        }

        try {
            validateWorkflow(value);
        } catch (error) {
            const message = getErrorMessage(error, 'Invalid workflow');
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
    {#each nodeGroups as group (group.label)}
        {@const isExpanded = expandedGroups.has(group.label)}
        <div class="flex flex-col gap-0.5">
            <button
                type="button"
                class="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/80 hover:bg-muted/60 hover:text-foreground"
                onclick={() => toggleGroup(group.label)}
                aria-expanded={isExpanded}
            >
                {#if isExpanded}
                    <ChevronDown class="size-3.5" />
                {:else}
                    <ChevronRight class="size-3.5" />
                {/if}
                {group.label}
            </button>
            {#if isExpanded}
                {#each group.classes as nodeClass (nodeClass)}
                    <Button
                        size="sm"
                        variant="ghost"
                        class="h-7 justify-start pl-6 pr-3 text-xs"
                        disabled={nodeClass === 'Output' &&
                            Object.values(workflow.nodes).some(isOutputNode)}
                        onclick={() => addWorkflowNode(nodeClass)}
                    >
                        {WORKFLOW_NODE_DEFINITIONS[nodeClass].label}
                    </Button>
                {/each}
            {/if}
        </div>
    {/each}
{/snippet}

<div class="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted/20">
    <!-- Mobile: floating title + close -->
    {#if title !== undefined}
        <div
            class="absolute left-1/2 top-3 z-20 flex h-8 max-w-[60%] -translate-x-1/2 items-center rounded-full border bg-background/95 px-3 text-xs font-medium shadow-sm backdrop-blur md:hidden"
        >
            <span class="truncate">{title}</span>
        </div>
    {/if}
    <!-- Desktop: left-top panel -->
    <div
        class="absolute left-3 top-3 z-10 hidden max-h-[calc(100%-6rem)] w-56 flex-col gap-1 overflow-y-auto rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur md:flex"
    >
        {@render nodeAddList()}
    </div>

    {#if selectedNode}
        <div
            class="absolute right-3 top-14 z-10 flex items-center gap-2 rounded-lg border bg-background/95 px-2 py-1 shadow-sm backdrop-blur md:top-3"
        >
            <span class="max-w-40 truncate text-xs font-medium">{selectedNode.name}</span>
            {#if selectedNode.class === 'Output'}
                <span class="text-[10px] text-muted-foreground">Required</span>
            {:else}
                <Button
                    size="icon"
                    variant="ghost"
                    class="size-7 text-muted-foreground hover:text-destructive"
                    title="Delete selected node"
                    onclick={deleteSelectedNode}
                >
                    <Trash2 class="size-3.5" />
                </Button>
            {/if}
        </div>
    {/if}

    {#if Object.keys(workflow.nodes).length === 0}
        <div class="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
            <div
                class="pointer-events-auto flex flex-col items-center gap-3 rounded-xl border bg-background/90 p-6 text-center shadow-sm"
            >
                <p class="text-sm font-medium">This workflow is empty</p>
                <p class="max-w-64 text-xs text-muted-foreground">
                    Start with the required Output node, then connect an Agent or another source.
                </p>
                <Button size="sm" onclick={() => addWorkflowNode('Output')}
                    ><Plus class="size-3.5" /> Add Output</Button
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
                        +{diagnostics.length - 1} more issue{diagnostics.length > 2 ? 's' : ''}
                    </p>
                {/if}
            </div>
        </div>
    {/if}

    <SvelteFlow
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
                class="flex max-h-[60vh] flex-col gap-1 overflow-y-auto rounded-t-xl border-x border-t bg-background/95 p-2 shadow-lg backdrop-blur"
            >
                <div class="flex items-center justify-between px-1 pb-1">
                    <span class="text-xs font-semibold text-muted-foreground">Add node</span>
                    <button
                        type="button"
                        class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        onclick={() => (mobileNodePanelOpen = false)}
                        aria-label="Close node panel"
                    >
                        <ChevronDown class="size-4" />
                    </button>
                </div>
                {@render nodeAddList()}
            </div>
        {:else}
            <button
                type="button"
                class="mx-auto mb-2 flex h-9 items-center gap-1.5 rounded-full border bg-background/95 px-4 text-xs font-medium shadow-sm backdrop-blur hover:bg-muted"
                onclick={() => (mobileNodePanelOpen = true)}
            >
                <Plus class="size-3.5" />
                Add node
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
