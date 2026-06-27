<script lang="ts">
    import ModelConfigCard from './ModelConfigCard.svelte';
    import { appSettings, updatePreset } from '$lib/stores';
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

    interface Props {
        preset: Preset;
    }

    let { preset }: Props = $props();

    let advancedOpen = $state(false);

    let llmTypes = $derived.by(() => {
        const definitions: Record<string, LLMTypeDefinition> = {};
        const allTypes = [
            ...pluginManager.getInstances().flatMap((inst) => [...inst.llmTypes.values()]),
            ...[preset.chatWorkflow, $appSettings?.translation.workflow].flatMap(
                getWorkflowLLMTypes
            )
        ].filter((d) => d.type !== 'chat' && d.type !== 'aux');

        for (const d of allTypes) {
            definitions[d.type] = {
                type: d.type,
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
            preset.models.chat ?? { id: 'openai::gpt-5.4', provider: 'openai' };

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

<div class="flex flex-col gap-6">
    {#if preset.models.chat}
        <ModelConfigCard
            title="Main Model"
            badge="Generation"
            config={preset.models.chat}
            onModelChange={(p, m) => handleModelChange('chat', p, m)}
        />
    {/if}

    {#if preset.models.aux}
        <ModelConfigCard
            title="Auxiliary Model"
            badge="Utility / Summary"
            config={preset.models.aux}
            onModelChange={(p, m) => handleModelChange('aux', p, m)}
        />
    {/if}

    <section class="rounded-lg border bg-card p-4">
        <button
            type="button"
            class="flex w-full items-center justify-between text-left text-sm font-medium"
            onclick={() => (advancedOpen = !advancedOpen)}
        >
            <span>Advanced Task Overrides</span>
            <span class="text-xs text-muted-foreground">{advancedOpen ? 'Collapse' : 'Expand'}</span
            >
        </button>

        {#if advancedOpen}
            <div class="mt-4 flex flex-col gap-4">
                {#each llmTypes as role (role.type)}
                    {@const config = preset.models[role.type]}
                    <div class="rounded-md border p-4">
                        <div class="flex items-start justify-between gap-4">
                            <div>
                                <h4 class="text-sm font-semibold">{role.type}</h4>
                                {#if role.description}
                                    <p class="mt-1 text-xs text-muted-foreground">
                                        {role.description}
                                    </p>
                                {/if}
                            </div>
                            <label class="flex items-center gap-2 text-xs text-muted-foreground">
                                <span>Override</span>
                                <input
                                    type="checkbox"
                                    checked={config !== undefined}
                                    onchange={(e) =>
                                        e.currentTarget.checked
                                            ? enableOverride(role.type)
                                            : disableOverride(role.type)}
                                />
                            </label>
                        </div>

                        {#if config}
                            <div class="mt-4">
                                <ModelConfigCard
                                    title={`${role.type} Model`}
                                    badge="Override"
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
