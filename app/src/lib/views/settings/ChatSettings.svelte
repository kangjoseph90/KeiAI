<script lang="ts">
    import { Badge } from '$lib/components/ui/badge';
    import { Button } from '$lib/components/ui/button';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import { activePreset, updatePreset } from '$lib/stores';
    import type { WorkflowDefinition, WorkflowEditResult } from '$lib/workflow';
    import WorkflowEditorModal from '$lib/views/workflow/WorkflowEditorModal.svelte';
    import WorkflowPromptTab from '$lib/views/workflow/WorkflowPromptTab.svelte';
    import PresetsTab from './chatbot/PresetsTab.svelte';
    import ScriptsTab from './chatbot/ScriptsTab.svelte';

    type Tab = 'prompt' | 'scripts' | 'presets';
    let activeTab = $state<Tab>('prompt');
    let chatWorkflowEditorOpen = $state(false);
    let selectedPromptNodeId = $state<string | null>(null);

    const tabs: Array<{ id: Tab; label: string }> = [
        { id: 'prompt', label: 'Prompt' },
        { id: 'scripts', label: 'Scripts' },
        { id: 'presets', label: 'Presets' }
    ];

    $effect(() => {
        const workflow = $activePreset?.chatWorkflow;
        selectedPromptNodeId = workflow ? selectExistingNode(workflow, selectedPromptNodeId) : null;
    });

    async function applyPromptEdit(result: WorkflowEditResult) {
        const preset = $activePreset;
        if (!preset) return;

        selectedPromptNodeId = selectExistingNode(result.workflow, selectedPromptNodeId);
        await updatePreset(preset.id, { chatWorkflow: result.patch });
    }

    function findFirstAgentId(workflow: WorkflowDefinition): string | null {
        return Object.values(workflow.nodes).find((node) => node.class === 'Agent')?.id ?? null;
    }

    function selectExistingNode(
        workflow: WorkflowDefinition,
        currentNodeId: string | null
    ): string | null {
        if (currentNodeId && workflow.nodes[currentNodeId]) return currentNodeId;
        return findFirstAgentId(workflow);
    }
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div class="mb-6 flex min-w-0 shrink-0 items-center justify-between gap-2">
        <div class="flex min-w-0 overflow-x-auto rounded-lg bg-muted/50 p-1">
            {#each tabs as tab (tab.id)}
                <button
                    class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors {activeTab ===
                    tab.id
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'}"
                    onclick={() => (activeTab = tab.id)}
                >
                    {tab.label}
                </button>
            {/each}
        </div>

        {#if $activePreset}
            <Badge variant="outline" class="hidden font-mono text-xs sm:inline-flex"
                >{$activePreset.name}</Badge
            >
        {/if}
    </div>

    {#if !$activePreset && activeTab !== 'presets'}
        <div class="flex flex-1 items-center justify-center p-12 text-center">
            <div class="flex flex-col gap-4">
                <p class="text-muted-foreground">No active preset selected.</p>
                <Button onclick={() => (activeTab = 'presets')}>Go to Presets</Button>
            </div>
        </div>
    {:else if activeTab === 'presets'}
        <ScrollArea class="-mr-4 min-h-0 flex-1 pr-4">
            <div class="flex flex-col gap-6 pb-8">
                <PresetsTab />
            </div>
        </ScrollArea>
    {:else if $activePreset && activeTab === 'prompt'}
        <div class="min-h-0 flex-1">
            <WorkflowPromptTab
                workflow={$activePreset.chatWorkflow}
                selectedNodeId={selectedPromptNodeId}
                onSelectNode={(nodeId) => (selectedPromptNodeId = nodeId)}
                onEdit={applyPromptEdit}
                onEditWorkflow={() => (chatWorkflowEditorOpen = true)}
            />
        </div>
    {:else if $activePreset}
        <ScrollArea class="-mr-4 min-h-0 flex-1 pr-4">
            <div class="flex flex-col gap-6 pb-8">
                {#if activeTab === 'scripts'}
                    <ScriptsTab preset={$activePreset} />
                {/if}
            </div>
        </ScrollArea>
    {/if}
</div>

{#if $activePreset}
    <WorkflowEditorModal
        bind:open={chatWorkflowEditorOpen}
        workflow={$activePreset.chatWorkflow}
        title="Chat Workflow"
        onPatch={(patch) => updatePreset($activePreset!.id, { chatWorkflow: patch })}
    />
{/if}
