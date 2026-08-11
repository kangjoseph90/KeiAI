<script lang="ts">
    import { Label } from '$lib/components/ui/label';
    import OptionSelect from '$lib/components/OptionSelect.svelte';
    import { appLocale, t, appSettings, updateAppLocale, updateSettings } from '$lib/stores';
    import WorkflowEditorModal from '$lib/views/workflow/WorkflowEditorModal.svelte';
    import WorkflowSummaryCard from '$lib/views/workflow/WorkflowSummaryCard.svelte';
    import { toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';
    import {
        LANGUAGES,
        getLanguageNativeName,
        UI_LOCALES,
        type LanguageCode,
        type UiLocale
    } from '$lib/language';

    let translationWorkflowEditorOpen = $state(false);
    let localeBusy = $state(false);

    async function handleLocaleChange(locale: UiLocale): Promise<void> {
        if (localeBusy || locale === $appLocale) return;
        localeBusy = true;
        try {
            await updateAppLocale(locale);
        } catch (error) {
            toast.error({
                title: $t('settings.language.updateFailed'),
                description: getErrorMessage(error)
            });
        } finally {
            localeBusy = false;
        }
    }

    async function updateTranslationSettings(
        changes: Parameters<typeof updateSettings>[0]
    ): Promise<void> {
        try {
            await updateSettings(changes);
        } catch (error) {
            toast.error({
                title: $t('settings.language.translationFailed'),
                description: getErrorMessage(
                    error,
                    $t('settings.language.translationFailedFallback')
                )
            });
        }
    }
</script>

<div class="space-y-8 pb-8">
    <section class="space-y-4">
        <div>
            <h3 class="text-lg font-semibold tracking-tight text-foreground">
                {$t('settings.language.interface.title')}
            </h3>
            <p class="text-sm text-muted-foreground">
                {$t('settings.language.interface.description')}
            </p>
        </div>

        <OptionSelect
            id="setting-interface-language"
            class="w-full max-w-xs sm:w-64"
            value={$appLocale}
            disabled={localeBusy}
            ariaBusy={localeBusy}
            options={UI_LOCALES.map((locale) => ({
                value: locale,
                label: getLanguageNativeName(locale)
            }))}
            onChange={(value) => handleLocaleChange(value as UiLocale)}
        />
    </section>

    <div class="border-t border-border"></div>

    <!-- Translation Section -->
    <section class="space-y-4">
        <div>
            <h3 class="text-lg font-semibold tracking-tight text-foreground">
                {$t('settings.language.translation.title')}
            </h3>
            <p class="text-sm text-muted-foreground">
                {$t('settings.language.translation.description')}
            </p>
        </div>

        <div class="space-y-4">
            <div class="flex flex-col gap-1.5">
                <div class="flex flex-col sm:flex-row gap-4 sm:items-start">
                    <div class="flex flex-col gap-1.5 w-full sm:w-64 max-w-xs">
                        <Label for="translation-target-language">
                            {$t('settings.language.translation.targetLabel')}
                        </Label>
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
                            <Label for="translation-secondary-language">
                                {$t('settings.language.translation.secondaryLabel')}
                            </Label>
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
                    {$t('settings.language.translation.sourceDetected')}
                </p>
            </div>

            <div class="divide-y divide-border">
                <div class="flex items-center justify-between py-3.5">
                    <div class="space-y-0.5 pr-4">
                        <Label
                            for="translation-bidirectional"
                            class="text-sm font-medium cursor-pointer"
                        >
                            {$t('settings.language.translation.bidirectional')}
                        </Label>
                        <p class="text-xs text-muted-foreground">
                            {$t('settings.language.translation.bidirectionalHelp')}
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
                            {$t('settings.language.translation.autoShow')}
                        </Label>
                        <p class="text-xs text-muted-foreground">
                            {$t('settings.language.translation.autoShowHelp')}
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
                    {$t('settings.language.translation.workflow.title')}
                </h3>
                <p class="text-sm text-muted-foreground">
                    {$t('settings.language.translation.workflow.description')}
                </p>
            </div>

            <WorkflowSummaryCard
                wide
                workflow={$appSettings.translation.workflow}
                onEditWorkflow={() => (translationWorkflowEditorOpen = true)}
                onPatch={(patch) => updateSettings({ translation: { workflow: patch } })}
                workflowLabel={$t('settings.language.translation.workflow.label')}
            />
        </section>
    {/if}
</div>

{#if $appSettings}
    <WorkflowEditorModal
        bind:open={translationWorkflowEditorOpen}
        workflow={$appSettings.translation.workflow}
        title={$t('settings.language.translation.workflow.title')}
        onPatch={(patch) => updateSettings({ translation: { workflow: patch } })}
    />
{/if}
