<script lang="ts">
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
    import SettingRow from '$lib/components/SettingRow.svelte';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { appSettings, updateSettings } from '$lib/stores';
    import WorkflowEditorModal from '$lib/views/workflow/WorkflowEditorModal.svelte';
    import WorkflowSummaryCard from '$lib/views/workflow/WorkflowSummaryCard.svelte';
    import { toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    let translationWorkflowEditorOpen = $state(false);

    async function updateTranslationSettings(
        changes: Parameters<typeof updateSettings>[0]
    ): Promise<void> {
        try {
            await updateSettings(changes);
        } catch (error) {
            toast.error({
                title: 'Translation setting failed',
                description: getErrorMessage(error, 'The translation setting could not be saved')
            });
        }
    }
</script>

<div class="flex flex-col gap-5">
    <Card>
        <CardHeader>
            <CardTitle class="text-base">Translation</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
            <div class="flex max-w-md flex-col gap-1.5">
                <Label for="translation-target-language">Target Language</Label>
                <Input
                    id="translation-target-language"
                    value={$appSettings?.translation.targetLanguage ?? ''}
                    placeholder="e.g. Korean"
                    onchange={(event) =>
                        updateTranslationSettings({
                            translation: {
                                targetLanguage: event.currentTarget.value
                            }
                        })}
                />
            </div>

            <SettingRow>
                <div class="space-y-0.5">
                    <Label for="translation-auto-show">Auto-show Translation</Label>
                    <p class="text-xs text-muted-foreground">
                        Automatically show translations when a message has been translated.
                    </p>
                </div>
                <input
                    id="translation-auto-show"
                    type="checkbox"
                    class="size-5 shrink-0 rounded border-primary"
                    checked={$appSettings?.translation?.autoShowTranslation === true}
                    onchange={(e) =>
                        updateTranslationSettings({
                            translation: {
                                autoShowTranslation: e.currentTarget.checked
                            }
                        })}
                />
            </SettingRow>
        </CardContent>
    </Card>

    {#if $appSettings}
        <WorkflowSummaryCard
            workflow={$appSettings.translation.workflow}
            onEditWorkflow={() => (translationWorkflowEditorOpen = true)}
            workflowLabel="Translation workflow"
            editWorkflowLabel="Edit translation workflow"
        />
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
