<script lang="ts">
    import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import { Bot, Workflow } from 'lucide-svelte';
    import {
        type WorkflowDefinition,
        type WorkflowEditResult,
        type WorkflowPatch
    } from '$lib/workflow';
    import WorkflowGraphTab from './WorkflowGraphTab.svelte';
    import WorkflowAgentTab from './WorkflowAgentTab.svelte';
    import { toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';
    import { t } from '$lib/stores';

    type EditorTab = 'graph' | 'agent';

    interface Props {
        open: boolean;
        workflow: WorkflowDefinition;
        title?: string;
        onPatch: (patch: WorkflowPatch) => void | Promise<void>;
    }

    let {
        open = $bindable(),
        workflow,
        title = $t('workflow.editor.title'),
        onPatch
    }: Props = $props();

    let draftWorkflow = $state.raw<WorkflowDefinition>({ nodes: {} });
    let selectedNodeId = $state<string | null>(null);
    let activeTab = $state<EditorTab>('graph');
    let wasOpen = $state(false);
    let saving = $state(false);
    let graphTabButton = $state<HTMLButtonElement>();
    let agentTabButton = $state<HTMLButtonElement>();
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
                title: $t('workflow.toast.updateFailed'),
                description: getErrorMessage(error, $t('workflow.toast.updateFailedDescription'))
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

    function selectTab(tab: EditorTab, nodeId?: string): void {
        if (tab === 'agent') {
            const selectedNode = selectedNodeId ? draftWorkflow.nodes[selectedNodeId] : undefined;
            selectedNodeId =
                nodeId ??
                (selectedNode?.class === 'Agent'
                    ? selectedNode.id
                    : findFirstAgentId(draftWorkflow));
        }
        activeTab = tab;
    }

    function handleTabKeydown(event: KeyboardEvent, tab: EditorTab): void {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const nextTab = tab === 'graph' ? 'agent' : 'graph';
        selectTab(nextTab);
        (nextTab === 'graph' ? graphTabButton : agentTabButton)?.focus();
    }
</script>

<Dialog bind:open>
    <DialogContent class="workflow-editor-dialog flex flex-col gap-0 overflow-hidden p-0">
        <DialogHeader
            class="flex flex-row items-center gap-2.5 border-b px-4 py-3.5 pr-12 text-left sm:pl-6 sm:pr-12"
        >
            <div
                class="flex shrink-0 items-center rounded-lg border bg-muted/40 p-0.5"
                role="tablist"
                aria-label={$t('workflow.editor.viewAria')}
            >
                <button
                    bind:this={graphTabButton}
                    type="button"
                    role="tab"
                    id="workflow-graph-tab"
                    aria-label={$t('workflow.editor.graphAria')}
                    aria-selected={activeTab === 'graph'}
                    aria-controls="workflow-graph-panel"
                    tabindex={activeTab === 'graph' ? 0 : -1}
                    title={$t('workflow.editor.graphTitle')}
                    class="flex size-8 items-center justify-center rounded-md transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring {activeTab ===
                    'graph'
                        ? 'bg-sky-500/15 text-sky-600 shadow-xs dark:text-sky-300'
                        : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'}"
                    onclick={() => selectTab('graph')}
                    onkeydown={(event) => handleTabKeydown(event, 'graph')}
                >
                    <Workflow class="size-4" />
                </button>
                <button
                    bind:this={agentTabButton}
                    type="button"
                    role="tab"
                    id="workflow-agent-tab"
                    aria-label={$t('workflow.editor.agentAria')}
                    aria-selected={activeTab === 'agent'}
                    aria-controls="workflow-agent-panel"
                    tabindex={activeTab === 'agent' ? 0 : -1}
                    title={$t('workflow.editor.agentTitle')}
                    class="flex size-8 items-center justify-center rounded-md transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring {activeTab ===
                    'agent'
                        ? 'bg-violet-500/15 text-violet-600 shadow-xs dark:text-violet-300'
                        : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'}"
                    onclick={() => selectTab('agent')}
                    onkeydown={(event) => handleTabKeydown(event, 'agent')}
                >
                    <Bot class="size-4" />
                </button>
            </div>

            <DialogTitle class="min-w-0 truncate text-base font-semibold text-foreground">
                {title}
            </DialogTitle>
        </DialogHeader>

        <div id="workflow-editor-panel" class="flex min-h-0 flex-1 flex-col" aria-busy={saving}>
            <div
                id="workflow-graph-panel"
                class="flex min-h-0 flex-1 flex-col"
                class:hidden={activeTab !== 'graph'}
                role="tabpanel"
                aria-labelledby="workflow-graph-tab"
                aria-hidden={activeTab !== 'graph'}
                inert={activeTab !== 'graph'}
            >
                <WorkflowGraphTab
                    workflow={draftWorkflow}
                    {selectedNodeId}
                    onSelectNode={(nodeId) => (selectedNodeId = nodeId)}
                    onEdit={applyEdit}
                    onEditAgent={(nodeId) => selectTab('agent', nodeId)}
                    active={activeTab === 'graph'}
                    {title}
                />
            </div>
            <div
                id="workflow-agent-panel"
                class="flex min-h-0 flex-1 flex-col"
                class:hidden={activeTab !== 'agent'}
                role="tabpanel"
                aria-labelledby="workflow-agent-tab"
                aria-hidden={activeTab !== 'agent'}
                inert={activeTab !== 'agent'}
            >
                <ScrollArea class="h-full min-h-0 bg-muted/15">
                    <WorkflowAgentTab
                        workflow={draftWorkflow}
                        {selectedNodeId}
                        onSelectNode={(nodeId) => (selectedNodeId = nodeId)}
                        onEdit={applyEdit}
                    />
                </ScrollArea>
            </div>
        </div>
    </DialogContent>
</Dialog>
