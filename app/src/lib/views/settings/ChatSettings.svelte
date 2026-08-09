<script lang="ts">
    import { Badge } from '$lib/components/ui/badge';
    import { Button } from '$lib/components/ui/button';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import { activePreset, appSettings, updatePreset, updateSettings } from '$lib/stores';
    import WorkflowEditorModal from '$lib/views/workflow/WorkflowEditorModal.svelte';
    import WorkflowSummaryCard from '$lib/views/workflow/WorkflowSummaryCard.svelte';
    import PresetsTab from './chatbot/PresetsTab.svelte';
    import ScriptsTab from './chatbot/ScriptsTab.svelte';
    import TogglesTab from './chatbot/TogglesTab.svelte';

    type Tab = 'workflow' | 'scripts' | 'toggles' | 'presets';
    let activeTab = $state<Tab>('workflow');
    let chatWorkflowEditorOpen = $state(false);
    let suggestionWorkflowEditorOpen = $state(false);
    let titleWorkflowEditorOpen = $state(false);

    const tabs: Array<{ id: Tab; label: string }> = [
        { id: 'workflow', label: 'Workflow' },
        { id: 'scripts', label: 'Scripts' },
        { id: 'toggles', label: 'Toggles' },
        { id: 'presets', label: 'Presets' }
    ];
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div class="mb-4 flex min-w-0 shrink-0 overflow-x-auto rounded-lg bg-muted/50 p-1">
        {#each tabs as tab (tab.id)}
            <button
                type="button"
                class="min-w-fit flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors {activeTab ===
                tab.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'}"
                onclick={() => (activeTab = tab.id)}
            >
                {tab.label}
            </button>
        {/each}
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
            <div class="flex flex-col gap-5 pb-8">
                <PresetsTab />
            </div>
        </ScrollArea>
    {:else if $activePreset && activeTab === 'workflow'}
        <ScrollArea class="-mr-4 min-h-0 flex-1 pr-4">
            <div class="flex flex-col gap-5 pb-8">
                <WorkflowSummaryCard
                    workflow={$activePreset.chatWorkflow}
                    onEditWorkflow={() => (chatWorkflowEditorOpen = true)}
                    workflowLabel="Chat workflow"
                    editWorkflowLabel="Edit workflow"
                />
                {#if $appSettings}
                    <WorkflowSummaryCard
                        workflow={$appSettings.suggestion.workflow}
                        onEditWorkflow={() => (suggestionWorkflowEditorOpen = true)}
                        workflowLabel="Suggestion workflow"
                        editWorkflowLabel="Edit suggestion workflow"
                    />
                    <WorkflowSummaryCard
                        workflow={$appSettings.titleGeneration.workflow}
                        onEditWorkflow={() => (titleWorkflowEditorOpen = true)}
                        workflowLabel="Title generation workflow"
                        editWorkflowLabel="Edit title workflow"
                    />
                {/if}
            </div>
        </ScrollArea>
    {:else if $activePreset}
        <ScrollArea class="-mr-4 min-h-0 flex-1 pr-4">
            <div class="flex flex-col gap-5 pb-8">
                {#if activeTab === 'scripts'}
                    <ScriptsTab preset={$activePreset} />
                {:else if activeTab === 'toggles'}
                    <TogglesTab preset={$activePreset} />
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

{#if $appSettings}
    <WorkflowEditorModal
        bind:open={suggestionWorkflowEditorOpen}
        workflow={$appSettings.suggestion.workflow}
        title="Suggestion Workflow"
        onPatch={(patch) => updateSettings({ suggestion: { workflow: patch } })}
    />
    <WorkflowEditorModal
        bind:open={titleWorkflowEditorOpen}
        workflow={$appSettings.titleGeneration.workflow}
        title="Title Workflow"
        onPatch={(patch) => updateSettings({ titleGeneration: { workflow: patch } })}
    />
{/if}
