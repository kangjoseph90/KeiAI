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
    import { Plus, Trash2, TriangleAlert } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { getErrorMessage } from '$lib/types/errors';
    import {
        WORKFLOW_NODE_DEFINITIONS,
        connectNodes,
        createAgentInput,
        createNode,
        deleteAgentInput,
        deleteNode,
        disconnectNodeInput,
        renameAgentInput,
        updateNode,
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
        onEditPrompt: (nodeId: string) => void;
        onEdit: (result: WorkflowEditResult) => void | Promise<void>;
    }

    let { workflow, selectedNodeId, onSelectNode, onEditPrompt, onEdit }: Props = $props();
    let nodes = $state.raw<WorkflowCanvasNode[]>([]);
    let edges = $state.raw<Edge[]>([]);

    const nodeTypes = { workflow: WorkflowNodeComponent } satisfies NodeTypes;
    const nodeGroups: Array<{ label: string; classes: WorkflowNodeClass[] }> = [
        { label: 'Agent', classes: ['Agent'] },
        { label: 'Operators', classes: ['String', 'Concat'] },
        { label: 'Files', classes: ['FileRead', 'FileWrite'] },
        { label: 'Result', classes: ['Output'] }
    ];

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
                onEditPrompt,
                onAddSlot: addAgentSlot,
                onRenameSlot: renameAgentSlot,
                onDeleteSlot: deleteAgentSlot,
                onUpdateNode: editNode
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

    function handleConnect(connection: Connection) {
        if (!connection.source || !connection.target || !connection.targetHandle) return;
        const sourcePort = Number(connection.sourceHandle ?? 0);
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

    function handleDelete(event: { nodes: WorkflowCanvasNode[]; edges: Edge[] }) {
        for (const edge of event.edges) {
            if (edge.targetHandle && workflow.nodes[edge.target]) {
                void onEdit(disconnectNodeInput(workflow, edge.target, edge.targetHandle));
            }
        }
        for (const node of event.nodes) {
            const workflowNode = workflow.nodes[node.id];
            if (workflowNode && workflowNode.class !== 'Output') {
                void onEdit(deleteNode(workflow, node.id));
            }
        }
    }

    function deleteSelectedNode() {
        if (!selectedNode || selectedNode.class === 'Output') return;
        const result = deleteNode(workflow, selectedNode.id);
        onSelectNode(null);
        return onEdit(result);
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
                if (port.required && !node.inputs[inputId] && !node.inputValues[inputId]?.trim()) {
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
</script>

<div class="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted/20">
    <div
        class="absolute left-3 top-3 z-10 flex items-stretch rounded-lg border bg-background/95 p-1 shadow-sm backdrop-blur"
    >
        {#each nodeGroups as group, groupIndex (group.label)}
            {#if groupIndex > 0}<div class="mx-1 w-px bg-border"></div>{/if}
            <div class="flex items-center gap-0.5">
                <span
                    class="px-1.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                    {group.label}
                </span>
                {#each group.classes as nodeClass (nodeClass)}
                    <Button
                        size="sm"
                        variant="ghost"
                        class="h-7 gap-1 px-2 text-xs"
                        disabled={nodeClass === 'Output' &&
                            Object.values(workflow.nodes).some(isOutputNode)}
                        onclick={() => addWorkflowNode(nodeClass)}
                    >
                        <Plus class="size-3" />
                        {WORKFLOW_NODE_DEFINITIONS[nodeClass].label}
                    </Button>
                {/each}
            </div>
        {/each}
    </div>

    {#if selectedNode}
        <div
            class="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-lg border bg-background/95 px-2 py-1 shadow-sm backdrop-blur"
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
            class="absolute bottom-3 left-1/2 z-10 flex max-w-[min(42rem,calc(100%-8rem))] -translate-x-1/2 items-start gap-2 rounded-lg border border-destructive/30 bg-background/95 px-3 py-2 text-xs shadow-sm backdrop-blur"
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
</div>
