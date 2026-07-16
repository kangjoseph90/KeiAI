<script lang="ts">
    import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
    import type { WorkflowDefinition, WorkflowEditResult, WorkflowPatch } from '$lib/workflow';
    import WorkflowGraphTab from './WorkflowGraphTab.svelte';
    import { toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    interface Props {
        open: boolean;
        workflow: WorkflowDefinition;
        title?: string;
        onPatch: (patch: WorkflowPatch) => void | Promise<void>;
        onEditPrompt?: (nodeId: string) => void;
    }

    let {
        open = $bindable(),
        workflow,
        title = 'Workflow Editor',
        onPatch,
        onEditPrompt
    }: Props = $props();

    let draftWorkflow = $state.raw<WorkflowDefinition>({ nodes: {} });
    let selectedNodeId = $state<string | null>(null);
    let wasOpen = $state(false);
    let saving = $state(false);
    const patchQueue: WorkflowPatch[] = [];

    $effect(() => {
        if (open && !wasOpen) {
            resetDraft();
        }
        wasOpen = open;
    });

    async function applyEdit(result: WorkflowEditResult) {
        draftWorkflow = result.workflow;
        selectedNodeId = selectExistingNode(draftWorkflow, selectedNodeId);
        patchQueue.push(result.patch);
        if (saving) return;

        saving = true;
        try {
            while (patchQueue.length > 0) {
                const patch = patchQueue.shift();
                if (patch) await onPatch(patch);
            }
        } catch (error) {
            patchQueue.length = 0;
            resetDraft();
            toast.error({
                title: 'Workflow update failed',
                description: getErrorMessage(error, 'The workflow change could not be saved')
            });
        } finally {
            saving = false;
        }
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
    <DialogContent centered={false} class="app-dialog-fullscreen flex flex-col gap-0 md:gap-4">
        <DialogHeader class="hidden shrink-0 sm:p-0 md:block">
            <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div class="flex min-h-0 flex-1 flex-col sm:px-0 sm:pb-0" aria-busy={saving}>
            <WorkflowGraphTab
                workflow={draftWorkflow}
                {selectedNodeId}
                onSelectNode={(nodeId) => (selectedNodeId = nodeId)}
                onEdit={applyEdit}
                {onEditPrompt}
                {title}
            />
        </div>
    </DialogContent>
</Dialog>
