<script lang="ts">
    import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
    import type { WorkflowDefinition, WorkflowEditResult, WorkflowPatch } from '$lib/workflow';
    import WorkflowGraphTab from './WorkflowGraphTab.svelte';

    interface Props {
        open: boolean;
        workflow: WorkflowDefinition;
        title?: string;
        onPatch: (patch: WorkflowPatch) => void | Promise<void>;
    }

    let { open = $bindable(), workflow, title = 'Workflow Editor', onPatch }: Props = $props();

    let draftWorkflow = $state.raw<WorkflowDefinition>({ nodes: {} });
    let selectedNodeId = $state<string | null>(null);
    let wasOpen = $state(false);

    $effect(() => {
        if (open && !wasOpen) {
            resetDraft();
        }
        wasOpen = open;
    });

    async function applyEdit(result: WorkflowEditResult) {
        draftWorkflow = result.workflow;
        selectedNodeId = selectExistingNode(draftWorkflow, selectedNodeId);
        await onPatch(result.patch);
    }

    function resetDraft() {
        const nextWorkflow = structuredClone(workflow);
        draftWorkflow = nextWorkflow;
        selectedNodeId =
            findFirstAgentId(nextWorkflow) ?? Object.keys(nextWorkflow.nodes)[0] ?? null;
    }

    function findFirstAgentId(value: WorkflowDefinition): string | null {
        return Object.values(value.nodes).find((node) => node.class === 'Agent')?.id ?? null;
    }

    function selectExistingNode(
        value: WorkflowDefinition,
        currentNodeId: string | null
    ): string | null {
        if (currentNodeId && value.nodes[currentNodeId]) return currentNodeId;
        return findFirstAgentId(value) ?? Object.keys(value.nodes)[0] ?? null;
    }
</script>

<Dialog bind:open>
    <DialogContent
        class="grid h-[90vh] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-[92vw]"
    >
        <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div class="flex min-h-0 flex-col">
            <WorkflowGraphTab
                workflow={draftWorkflow}
                {selectedNodeId}
                onSelectNode={(nodeId) => (selectedNodeId = nodeId)}
                onEdit={applyEdit}
            />
        </div>
    </DialogContent>
</Dialog>
