<script lang="ts">
    import ModelConfigCard from './ModelConfigCard.svelte';
    import { appSettings, updatePreset } from '$lib/stores';
    import {
        BUILT_IN_LLM_MODELS,
        type LLMProvider,
        type LLMModelConfig,
        type LLMModelBase
    } from '$lib/types/models/llm';
    import type { Preset } from '$lib/services/content/preset';

    interface Props {
        preset: Preset;
    }

    let { preset }: Props = $props();

    function handleModelChange(type: 'chat' | 'aux', provider: LLMProvider, modelId: string) {
        let model: LLMModelBase | undefined;

        if (provider === 'custom') {
            model = $appSettings?.custom?.llm?.models.find((m) => m.id === modelId);
        } else {
            model = BUILT_IN_LLM_MODELS.find((m) => m.id === modelId);
        }

        const update: Partial<LLMModelConfig> = {
            provider,
            id: modelId,
            tokenizer: model?.tokenizer
        };

        if (type === 'chat') {
            updatePreset(preset.id, { chatModel: update });
        } else {
            updatePreset(preset.id, { auxModel: update });
        }
    }
</script>

<div class="flex flex-col gap-6">
    <ModelConfigCard
        title="Main Model"
        badge="Generation"
        config={preset.chatModel}
        onModelChange={(p, m) => handleModelChange('chat', p, m)}
    />

    <ModelConfigCard
        title="Auxiliary Model"
        badge="Utility / Summary"
        config={preset.auxModel}
        onModelChange={(p, m) => handleModelChange('aux', p, m)}
    />
</div>
