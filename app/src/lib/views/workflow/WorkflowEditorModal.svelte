<script lang="ts">
    import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
    import type { WorkflowDefinition, WorkflowEditResult, WorkflowPatch } from '$lib/workflow';
    import WorkflowGraphTab from './WorkflowGraphTab.svelte';
    import WorkflowPromptTab from './WorkflowPromptTab.svelte';

    type EditorTab = 'prompt' | 'workflow';

    interface Props {
        open: boolean;
        workflow: WorkflowDefinition;
        title?: string;
        onPatch: (patch: WorkflowPatch) => void | Promise<void>;
    }

    let { open = $bindable(), workflow, title = 'Workflow Editor', onPatch }: Props = $props();

    let draftWorkflow = $state.raw<WorkflowDefinition>({ nodes: {} });
    let activeTab = $state<EditorTab>('prompt');
    let selectedNodeId = $state<string | null>(null);

    $effect(() => {
        if (!open) {
            const nextWorkflow = structuredClone(workflow);
            draftWorkflow = nextWorkflow;
            selectedNodeId = findFirstAgentId(nextWorkflow);
        }
    });

    async function applyEdit(result: WorkflowEditResult) {
        draftWorkflow = result.workflow;
        selectedNodeId = selectExistingNode(draftWorkflow, selectedNodeId);
        await onPatch(result.patch);
    }

    function editPrompt(nodeId: string) {
        selectedNodeId = nodeId;
        activeTab = 'prompt';
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
            <div class="flex items-center gap-6 pr-8">
                <DialogTitle>{title}</DialogTitle>
                <div class="flex rounded-lg bg-muted p-1">
                    <button
                        class="rounded-md px-4 py-1.5 text-sm {activeTab === 'prompt'
                            ? 'bg-background shadow-sm'
                            : 'text-muted-foreground'}"
                        onclick={() => (activeTab = 'prompt')}>Prompt</button
                    >
                    <button
                        class="rounded-md px-4 py-1.5 text-sm {activeTab === 'workflow'
                            ? 'bg-background shadow-sm'
                            : 'text-muted-foreground'}"
                        onclick={() => (activeTab = 'workflow')}>Workflow</button
                    >
                </div>
            </div>
        </DialogHeader>

        <div class="flex min-h-0 flex-col">
            {#if activeTab === 'prompt'}
                <WorkflowPromptTab
                    workflow={draftWorkflow}
                    {selectedNodeId}
                    onSelectNode={(nodeId) => (selectedNodeId = nodeId)}
                    onEdit={applyEdit}
                />
            {:else}
                <WorkflowGraphTab
                    workflow={draftWorkflow}
                    {selectedNodeId}
                    onSelectNode={(nodeId) => (selectedNodeId = nodeId)}
                    onEditPrompt={editPrompt}
                    onEdit={applyEdit}
                />
            {/if}
        </div>
    </DialogContent>
</Dialog>
