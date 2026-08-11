<script lang="ts">
    import { ChevronDown, ChevronRight } from 'lucide-svelte';
    import { slide } from 'svelte/transition';
    import { Badge } from '$lib/components/ui/badge';
    import ModelConfigCard from './ModelConfigCard.svelte';
    import { appSettings, modules, selectActiveModules, updatePreset, t } from '$lib/stores';
    import {
        BUILT_IN_LLM_MODELS,
        type LLMProvider,
        type LLMModelConfig,
        type LLMModelBase,
        type LLMType,
        type LLMTypeDefinition
    } from '$lib/types/models/llm';
    import { pluginManager } from '$lib/plugins';
    import type { Preset } from '$lib/services/content/preset';
    import { getWorkflowLLMTypes } from '$lib/workflow/agent/llm';
    import { listItems } from '$lib/utils/ordering';

    interface Props {
        preset: Preset;
    }

    let { preset }: Props = $props();

    let advancedOpen = $state(false);

    let llmTypes = $derived.by(() => {
        const definitions: Record<string, LLMTypeDefinition> = {};
        const activeModules = selectActiveModules($appSettings, $modules);
        const commandWorkflows = [
            ...listItems(preset.commands).map((cmd) => cmd.workflow),
            ...activeModules.flatMap((mod) => listItems(mod.commands).map((cmd) => cmd.workflow))
        ];
        const allTypes = [
            ...pluginManager.getInstances().flatMap((inst) => [...inst.llmTypes.values()]),
            ...[
                preset.chatWorkflow,
                $appSettings?.translation.workflow,
                $appSettings?.imageGeneration.workflow,
                $appSettings?.tts.workflow,
                $appSettings?.suggestion.workflow,
                $appSettings?.titleGeneration.workflow,
                ...commandWorkflows
            ].flatMap(getWorkflowLLMTypes)
        ].filter((d) => d.type !== 'chat' && d.type !== 'aux');

        for (const d of allTypes) {
            const existingNames = definitions[d.type]?.agentNames ?? [];
            const newNames = d.agentNames ?? [];
            const mergedNames = Array.from(new Set([...existingNames, ...newNames]));

            definitions[d.type] = {
                type: d.type,
                agentNames: mergedNames.length > 0 ? mergedNames : undefined,
                description: definitions[d.type]?.description ?? d.description
            };
        }
        return Object.values(definitions);
    });

    function handleModelChange(type: LLMType, provider: LLMProvider, modelId: string) {
        let model: LLMModelBase | undefined;

        if (provider === 'custom') {
            model = $appSettings?.custom?.llm?.models[modelId];
        } else if (provider === 'plugin') {
            model = pluginManager
                .getInstances()
                .flatMap((instance) => [...instance.llmProviders.values()].map((p) => p.model))
                .find((m) => m.id === modelId);
        } else {
            model = BUILT_IN_LLM_MODELS.find((m) => m.id === modelId);
        }

        const update: LLMModelConfig = {
            provider,
            id: modelId,
            tokenizer: model?.tokenizer
        };

        updatePreset(preset.id, {
            models: {
                [type]: update
            }
        });
    }

    function enableOverride(type: LLMType) {
        const fallback: LLMModelConfig = preset.models.aux ??
            preset.models.chat ?? { id: 'openai::gpt-5.6', provider: 'openai' };

        updatePreset(preset.id, {
            models: {
                [type]: { ...fallback }
            }
        });
    }

    function disableOverride(type: LLMType) {
        updatePreset(preset.id, {
            models: {
                [type]: undefined
            }
        });
    }
</script>

<div class="space-y-8 pb-8">
    {#if preset.models.chat}
        <section class="space-y-4">
            <div>
                <h3
                    class="flex items-center justify-between text-lg font-semibold tracking-tight text-foreground"
                >
                    {$t('settings.modelTab.chatModel')}
                    <Badge variant="secondary">{$t('settings.modelTab.chatBadge')}</Badge>
                </h3>
                <p class="text-sm text-muted-foreground">
                    {$t('settings.modelTab.chatDescription')}
                </p>
            </div>
            <ModelConfigCard
                config={preset.models.chat}
                onModelChange={(p, m) => handleModelChange('chat', p, m)}
            />
        </section>
    {/if}

    {#if preset.models.aux}
        <div class="border-t border-border"></div>

        <section class="space-y-4">
            <div>
                <h3
                    class="flex items-center justify-between text-lg font-semibold tracking-tight text-foreground"
                >
                    {$t('settings.modelTab.auxiliaryModel')}
                    <Badge variant="outline">{$t('settings.modelTab.auxBadge')}</Badge>
                </h3>
                <p class="text-sm text-muted-foreground">
                    {$t('settings.modelTab.auxiliaryDescription')}
                </p>
            </div>
            <ModelConfigCard
                config={preset.models.aux}
                onModelChange={(p, m) => handleModelChange('aux', p, m)}
            />
        </section>
    {/if}

    <div class="border-t border-border"></div>

    <section class="space-y-4">
        <div class="flex items-center gap-2">
            <button
                type="button"
                class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onclick={() => (advancedOpen = !advancedOpen)}
                aria-label={advancedOpen
                    ? $t('settings.modelTab.collapse')
                    : $t('settings.modelTab.expand')}
            >
                {#if advancedOpen}
                    <ChevronDown class="size-4" />
                {:else}
                    <ChevronRight class="size-4" />
                {/if}
            </button>
            <div>
                <button
                    type="button"
                    class="text-base font-medium text-foreground hover:opacity-80 transition-opacity"
                    onclick={() => (advancedOpen = !advancedOpen)}
                >
                    {$t('settings.modelTab.overridesButton')}
                </button>
                <p class="text-xs text-muted-foreground">
                    {$t('settings.modelTab.overridesDescription')}
                </p>
            </div>
        </div>

        {#if advancedOpen}
            <div class="pl-6 divide-y divide-border pt-1" transition:slide={{ duration: 150 }}>
                {#each llmTypes as role (role.type)}
                    {@const config = preset.models[role.type]}
                    <div class="py-4 space-y-4">
                        <div class="flex items-center justify-between">
                            <div>
                                <h4 class="text-base font-medium text-foreground">{role.type}</h4>
                                {#if role.agentNames && role.agentNames.length > 0}
                                    <p class="text-xs text-muted-foreground">
                                        {$t('settings.modelTab.modelUsedBy', {
                                            names: role.agentNames.join(', ')
                                        })}
                                    </p>
                                {:else if role.description}
                                    <p class="text-xs text-muted-foreground">
                                        {role.description}
                                    </p>
                                {/if}
                            </div>
                            <label
                                class="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer"
                            >
                                <span>{$t('settings.modelTab.override')}</span>
                                <input
                                    type="checkbox"
                                    class="size-5 shrink-0 rounded border-primary cursor-pointer"
                                    checked={config !== undefined}
                                    onchange={(e) =>
                                        e.currentTarget.checked
                                            ? enableOverride(role.type)
                                            : disableOverride(role.type)}
                                />
                            </label>
                        </div>
                        {#if config}
                            <div transition:slide={{ duration: 150 }}>
                                <ModelConfigCard
                                    {config}
                                    onModelChange={(p, m) => handleModelChange(role.type, p, m)}
                                />
                            </div>
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}
    </section>
</div>
