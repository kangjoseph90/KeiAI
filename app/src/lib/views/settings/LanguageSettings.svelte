<script lang="ts">
    import { Label } from '$lib/components/ui/label';
    import OptionSelect from '$lib/components/OptionSelect.svelte';
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

<div class="space-y-8 pb-8">
    <!-- Translation Section -->
    <section class="space-y-4">
        <div>
            <h3 class="text-lg font-semibold tracking-tight text-foreground">Translation</h3>
            <p class="text-sm text-muted-foreground">
                Configure automatic message translation and target languages.
            </p>
        </div>

        <div class="space-y-4">
            <div class="flex flex-col gap-1.5">
                <div class="flex flex-col sm:flex-row gap-4 sm:items-start">
                    <div class="flex flex-col gap-1.5 w-full sm:w-64 max-w-xs">
                        <Label for="translation-target-language">Target Language</Label>
                        <OptionSelect
                            id="translation-target-language"
                            value={$appSettings?.translation.targetLanguage ?? 'ko'}
                            options={LANGUAGES.map((lang) => ({
                                value: lang.code,
                                label: `${lang.name} (${getLanguageNativeName(lang.code)})`
                            }))}
                            onChange={(value) =>
                                updateTranslationSettings({
                                    translation: {
                                        targetLanguage: value as LanguageCode
                                    }
                                })}
                        />
                    </div>

                    {#if $appSettings?.translation?.bidirectional}
                        <div class="flex flex-col gap-1.5 w-full sm:w-64 max-w-xs">
                            <Label for="translation-secondary-language">Secondary Language</Label>
                            <OptionSelect
                                id="translation-secondary-language"
                                value={$appSettings?.translation.secondaryLanguage ?? 'en'}
                                options={LANGUAGES.map((lang) => ({
                                    value: lang.code,
                                    label: `${lang.name} (${getLanguageNativeName(lang.code)})`
                                }))}
                                onChange={(value) =>
                                    updateTranslationSettings({
                                        translation: {
                                            secondaryLanguage: value as LanguageCode
                                        }
                                    })}
                            />
                        </div>
                    {/if}
                </div>

                <p class="text-xs text-muted-foreground mt-1">
                    The source language is detected automatically from each message.
                </p>
            </div>

            <div class="divide-y divide-border">
                <div class="flex items-center justify-between py-3.5">
                    <div class="space-y-0.5 pr-4">
                        <Label
                            for="translation-bidirectional"
                            class="text-sm font-medium cursor-pointer"
                        >
                            Bidirectional Translation
                        </Label>
                        <p class="text-xs text-muted-foreground">
                            Pick a second language and auto-detect the direction per message.
                        </p>
                    </div>
                    <input
                        id="translation-bidirectional"
                        type="checkbox"
                        class="size-5 shrink-0 rounded border-primary cursor-pointer"
                        checked={$appSettings?.translation?.bidirectional === true}
                        onchange={(e) =>
                            updateTranslationSettings({
                                translation: {
                                    bidirectional: e.currentTarget.checked
                                }
                            })}
                    />
                </div>

                <div class="flex items-center justify-between py-3.5">
                    <div class="space-y-0.5 pr-4">
                        <Label
                            for="translation-auto-show"
                            class="text-sm font-medium cursor-pointer"
                        >
                            Auto-show Translation
                        </Label>
                        <p class="text-xs text-muted-foreground">
                            Automatically show translations when a message has been translated.
                        </p>
                    </div>
                    <input
                        id="translation-auto-show"
                        type="checkbox"
                        class="size-5 shrink-0 rounded border-primary cursor-pointer"
                        checked={$appSettings?.translation?.autoShowTranslation === true}
                        onchange={(e) =>
                            updateTranslationSettings({
                                translation: {
                                    autoShowTranslation: e.currentTarget.checked
                                }
                            })}
                    />
                </div>
            </div>
        </div>
    </section>

    {#if $appSettings}
        <div class="border-t border-border"></div>

        <!-- Workflow Section -->
        <section class="space-y-4">
            <div>
                <h3 class="text-lg font-semibold tracking-tight text-foreground">
                    Translation Workflow
                </h3>
                <p class="text-sm text-muted-foreground">
                    Customize the node pipeline used for translating chat messages.
                </p>
            </div>

            <WorkflowSummaryCard
                workflow={$appSettings.translation.workflow}
                onEditWorkflow={() => (translationWorkflowEditorOpen = true)}
                workflowLabel="Translation workflow"
                editWorkflowLabel="Edit translation workflow"
            />
        </section>
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
