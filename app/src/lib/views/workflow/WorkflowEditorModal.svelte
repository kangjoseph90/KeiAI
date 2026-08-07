<script lang="ts">
    import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
    import { FileText, Workflow } from 'lucide-svelte';
    import type { WorkflowDefinition, WorkflowEditResult, WorkflowPatch } from '$lib/workflow';
    import WorkflowGraphTab from './WorkflowGraphTab.svelte';
    import WorkflowPromptTab from './WorkflowPromptTab.svelte';
    import { toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    type EditorTab = 'graph' | 'prompt';

    interface Props {
        open: boolean;
        workflow: WorkflowDefinition;
        title?: string;
        onPatch: (patch: WorkflowPatch) => void | Promise<void>;
    }

    let { open = $bindable(), workflow, title = 'Workflow Editor', onPatch }: Props = $props();

    let draftWorkflow = $state.raw<WorkflowDefinition>({ nodes: {} });
    let selectedNodeId = $state<string | null>(null);
    let activeTab = $state<EditorTab>('graph');
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
        activeTab = 'graph';
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

    function openPromptTab(nodeId?: string): void {
        if (nodeId) selectedNodeId = nodeId;
        activeTab = 'prompt';
    }
</script>

<Dialog bind:open>
    <DialogContent class="workflow-editor-dialog flex flex-col gap-0 overflow-hidden p-0">
        <!-- Standardized Header with Left Icon Dropdown View Selector -->
        <DialogHeader
            class="flex flex-row items-center gap-2.5 border-b px-4 py-3.5 pr-12 text-left sm:px-6"
        >
            <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                    <button
                        type="button"
                        class="flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-muted/80 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring {activeTab ===
                        'graph'
                            ? 'bg-sky-500/15 text-sky-600 dark:text-sky-300'
                            : 'bg-violet-500/15 text-violet-600 dark:text-violet-300'}"
                        aria-label="Change editor view mode"
                        title="Change view mode"
                    >
                        {#if activeTab === 'graph'}
                            <Workflow class="size-4" />
                        {:else}
                            <FileText class="size-4" />
                        {/if}
                    </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="start">
                    <DropdownMenu.Item onclick={() => (activeTab = 'graph')}>
                        <Workflow class="mr-2 size-4 text-sky-500" />
                        <span>Graph view</span>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onclick={() => (activeTab = 'prompt')}>
                        <FileText class="mr-2 size-4 text-violet-500" />
                        <span>Prompt view</span>
                    </DropdownMenu.Item>
                </DropdownMenu.Content>
            </DropdownMenu.Root>

            <DialogTitle class="min-w-0 truncate text-base font-semibold text-foreground">
                {title}
            </DialogTitle>
        </DialogHeader>

        <div
            id="workflow-editor-panel"
            class="flex min-h-0 flex-1 flex-col"
            role="tabpanel"
            aria-busy={saving}
        >
            {#if activeTab === 'graph'}
                <WorkflowGraphTab
                    workflow={draftWorkflow}
                    {selectedNodeId}
                    onSelectNode={(nodeId) => (selectedNodeId = nodeId)}
                    onEdit={applyEdit}
                    onEditPrompt={openPromptTab}
                    {title}
                />
            {:else}
                <ScrollArea class="h-full min-h-0 bg-muted/15">
                    <WorkflowPromptTab
                        workflow={draftWorkflow}
                        {selectedNodeId}
                        onSelectNode={(nodeId) => (selectedNodeId = nodeId)}
                        onEdit={applyEdit}
                    />
                </ScrollArea>
            {/if}
        </div>
    </DialogContent>
</Dialog>
