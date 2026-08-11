<script lang="ts">
    import { Badge } from '$lib/components/ui/badge';
    import { Button } from '$lib/components/ui/button';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import {
        activePreset,
        createPresetFolder,
        deletePresetCommand,
        deletePresetFolder,
        movePresetItem,
        savePresetCommand,
        updatePresetFolder,
        updatePreset
    } from '$lib/stores';
    import WorkflowEditorModal from '$lib/views/workflow/WorkflowEditorModal.svelte';
    import WorkflowSummaryCard from '$lib/views/workflow/WorkflowSummaryCard.svelte';
    import PresetsTab from './chatbot/PresetsTab.svelte';
    import ScriptsTab from './chatbot/ScriptsTab.svelte';
    import TogglesTab from './chatbot/TogglesTab.svelte';
    import CommandsSection from './chatbot/CommandsSection.svelte';

    type Tab = 'workflow' | 'scripts' | 'toggles' | 'presets';
    let activeTab = $state<Tab>('workflow');
    let chatWorkflowEditorOpen = $state(false);

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
                    ? 'bg-background text-foreground shadow-sm dark:bg-accent'
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
    {:else if activeTab === 'workflow'}
        <ScrollArea class="-mr-4 min-h-0 flex-1 pr-4">
            <div class="space-y-8 pb-8">
                <section class="space-y-3">
                    <div>
                        <h3 class="text-lg font-semibold tracking-tight text-foreground">
                            Chat workflow
                        </h3>
                        <p class="text-sm text-muted-foreground">
                            Configure the workflow used to generate chat responses.
                        </p>
                    </div>
                    <WorkflowSummaryCard
                        wide
                        workflow={$activePreset!.chatWorkflow}
                        onEditWorkflow={() => (chatWorkflowEditorOpen = true)}
                        workflowLabel="Chat workflow"
                    />
                </section>
                <div class="border-t border-border"></div>
                <section>
                    <h3 class="text-lg font-semibold tracking-tight text-foreground">Commands</h3>
                    <CommandsSection
                        panel={$activePreset!.commands}
                        onSave={(command) => savePresetCommand($activePreset!.id, command)}
                        onDelete={(commandId) => deletePresetCommand($activePreset!.id, commandId)}
                        onCreateFolder={(name, parentId, sortOrder) =>
                            createPresetFolder(
                                $activePreset!.id,
                                'commands',
                                name,
                                parentId,
                                sortOrder
                            )}
                        onUpdateFolder={(folderId, changes) =>
                            updatePresetFolder($activePreset!.id, 'commands', folderId, changes)}
                        onDeleteFolder={(folderId) =>
                            deletePresetFolder($activePreset!.id, 'commands', folderId)}
                        onMoveItem={(commandId, folderId, sortOrder) =>
                            movePresetItem(
                                $activePreset!.id,
                                'commands',
                                commandId,
                                folderId,
                                sortOrder
                            )}
                    />
                </section>
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
