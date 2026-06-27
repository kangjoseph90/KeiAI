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
    import { Plus } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import {
        WORKFLOW_NODE_DEFINITIONS,
        connectNodes,
        createAgentInput,
        createNode,
        deleteNode,
        disconnectNodeInput,
        updateNode,
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
    const nodeClasses = Object.keys(WORKFLOW_NODE_DEFINITIONS) as WorkflowNodeClass[];

    $effect(() => {
        nodes = Object.values(workflow.nodes).map((node) => ({
            id: node.id,
            type: 'workflow',
            position: node.position,
            selected: node.id === selectedNodeId,
            data: {
                node,
                onEditPrompt,
                onAddSlot: addAgentSlot,
                onUpdateNode: editNode
            } satisfies WorkflowNodeData
        }));
        edges = createEdges(workflow);
    });

    function addWorkflowNode(nodeClass: WorkflowNodeClass) {
        const offset = Object.keys(workflow.nodes).length * 28;
        return onEdit(createNode(workflow, nodeClass, { x: 80 + offset, y: 80 + offset }));
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
            if (workflow.nodes[node.id]) void onEdit(deleteNode(workflow, node.id));
        }
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
                    targetHandle: inputId
                });
            }
        }
        return result;
    }
</script>

<div class="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted/20">
    <div
        class="absolute left-3 top-3 z-10 flex flex-wrap gap-1 rounded-md border bg-background/95 p-1 shadow-sm"
    >
        {#each nodeClasses as nodeClass (nodeClass)}
            <Button
                size="sm"
                variant="ghost"
                class="h-7 gap-1 px-2"
                onclick={() => addWorkflowNode(nodeClass)}
            >
                <Plus class="size-3" />
                {WORKFLOW_NODE_DEFINITIONS[nodeClass].label}
            </Button>
        {/each}
    </div>

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
