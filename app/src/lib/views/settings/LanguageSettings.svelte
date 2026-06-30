<script lang="ts">
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { appSettings, updateSettings } from '$lib/stores';
    import type { WorkflowDefinition, WorkflowEditResult } from '$lib/workflow';
    import WorkflowEditorModal from '$lib/views/workflow/WorkflowEditorModal.svelte';
    import WorkflowPromptTab from '$lib/views/workflow/WorkflowPromptTab.svelte';

    let translationWorkflowEditorOpen = $state(false);
    let selectedTranslationNodeId = $state<string | null>(null);

    $effect(() => {
        const workflow = $appSettings?.translation.workflow;
        selectedTranslationNodeId = workflow
            ? selectExistingNode(workflow, selectedTranslationNodeId)
            : null;
    });

    async function applyTranslationPromptEdit(result: WorkflowEditResult) {
        selectedTranslationNodeId = selectExistingNode(result.workflow, selectedTranslationNodeId);
        await updateSettings({ translation: { workflow: result.patch } });
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

<div class="flex flex-col gap-6">
    <Card>
        <CardHeader>
            <CardTitle class="text-base">Translation</CardTitle>
        </CardHeader>
        <CardContent class="space-y-6">
            <div class="flex max-w-md flex-col gap-1.5">
                <Label for="translation-target-language">Target Language</Label>
                <Input
                    id="translation-target-language"
                    value={$appSettings?.translation.targetLanguage ?? ''}
                    placeholder="e.g. Korean"
                    onchange={(event) =>
                        updateSettings({
                            translation: {
                                targetLanguage: event.currentTarget.value
                            }
                        })}
                />
            </div>
        </CardContent>
    </Card>

    {#if $appSettings}
        <div class="h-[calc(100vh-22rem)] min-h-[30rem]">
            <WorkflowPromptTab
                workflow={$appSettings.translation.workflow}
                selectedNodeId={selectedTranslationNodeId}
                onSelectNode={(nodeId) => (selectedTranslationNodeId = nodeId)}
                onEdit={applyTranslationPromptEdit}
                onEditWorkflow={() => (translationWorkflowEditorOpen = true)}
                editWorkflowLabel="Edit translation workflow"
            />
        </div>
    {/if}
</div>

{#if $appSettings}
    <WorkflowEditorModal
        bind:open={translationWorkflowEditorOpen}
        workflow={$appSettings.translation.workflow}
        title="Translation Workflow"
        onPatch={(patch) => updateSettings({ translation: { workflow: patch } })}
    />
{/if}
