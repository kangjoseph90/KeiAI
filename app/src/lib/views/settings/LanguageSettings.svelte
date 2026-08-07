<script lang="ts">
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
    import SettingRow from '$lib/components/SettingRow.svelte';
    import { Label } from '$lib/components/ui/label';
    import { appSettings, updateSettings } from '$lib/stores';
    import WorkflowEditorModal from '$lib/views/workflow/WorkflowEditorModal.svelte';
    import WorkflowSummaryCard from '$lib/views/workflow/WorkflowSummaryCard.svelte';
    import { toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';
    import { LANGUAGES, getLanguageNativeName, type LanguageCode } from '$lib/language';

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
            <div class="flex flex-col gap-1.5">
                <div class="flex flex-col sm:flex-row gap-4 sm:items-start">
                    <div class="flex flex-col gap-1.5 w-full sm:w-64 max-w-xs">
                        <Label for="translation-target-language">Target Language</Label>
                        <select
                            id="translation-target-language"
                            class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            value={$appSettings?.translation.targetLanguage ?? 'ko'}
                            onchange={(event) =>
                                updateTranslationSettings({
                                    translation: {
                                        targetLanguage: event.currentTarget.value as LanguageCode
                                    }
                                })}
                        >
                            {#each LANGUAGES as lang (lang.code)}
                                <option value={lang.code}
                                    >{lang.name} ({getLanguageNativeName(lang.code)})</option
                                >
                            {/each}
                        </select>
                    </div>

                    {#if $appSettings?.translation?.bidirectional}
                        <div class="flex flex-col gap-1.5 w-full sm:w-64 max-w-xs">
                            <Label for="translation-secondary-language">Secondary Language</Label>
                            <select
                                id="translation-secondary-language"
                                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                value={$appSettings?.translation.secondaryLanguage ?? 'en'}
                                onchange={(event) =>
                                    updateTranslationSettings({
                                        translation: {
                                            secondaryLanguage: event.currentTarget
                                                .value as LanguageCode
                                        }
                                    })}
                            >
                                {#each LANGUAGES as lang (lang.code)}
                                    <option value={lang.code}
                                        >{lang.name} ({getLanguageNativeName(lang.code)})</option
                                    >
                                {/each}
                            </select>
                        </div>
                    {/if}
                </div>

                <p class="text-xs text-muted-foreground">
                    The source language is detected automatically from each message.
                </p>
            </div>

            <SettingRow>
                <div class="space-y-0.5">
                    <Label for="translation-bidirectional">Bidirectional Translation</Label>
                    <p class="text-xs text-muted-foreground">
                        Pick a second language and auto-detect the direction per message.
                    </p>
                </div>
                <input
                    id="translation-bidirectional"
                    type="checkbox"
                    class="size-5 shrink-0 rounded border-primary"
                    checked={$appSettings?.translation?.bidirectional === true}
                    onchange={(e) =>
                        updateTranslationSettings({
                            translation: {
                                bidirectional: e.currentTarget.checked
                            }
                        })}
                />
            </SettingRow>

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
