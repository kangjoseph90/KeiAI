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
    <DialogContent
        class="flex h-[100dvh] max-w-none flex-col gap-0 p-0 sm:gap-4 sm:p-6 inset-0 translate-x-0 translate-y-0 rounded-none md:inset-auto md:top-1/2 md:left-1/2 md:h-[90vh] md:max-w-[calc(100%-2rem)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg lg:max-w-[92vw]"
    >
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
                onClose={() => (open = false)}
            />
        </div>
    </DialogContent>
</Dialog>
