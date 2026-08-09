<script lang="ts">
    import { Eye, EyeOff } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import OptionSelect from '$lib/components/OptionSelect.svelte';
    import { Separator } from '$lib/components/ui/separator';
    import { appSettings, updateSettings } from '$lib/stores';
    import {
        BUILT_IN_LLM_MODELS,
        getLLMProviderName,
        type LLMProvider,
        type LLMModelConfig
    } from '$lib/types/models/llm';
    import { pluginManager } from '$lib/plugins';
    import type { AppSettings } from '$lib/services/content/settings';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { compareSortOrder } from '$lib/utils/ordering';

    interface Props {
        config: LLMModelConfig;
        onModelChange: (provider: LLMProvider, modelId: string) => void;
    }

    let { config, onModelChange }: Props = $props();

    let showKey = $state(false);

    const providers: LLMProvider[] = [
        'openai',
        'anthropic',
        'google',
        'deepseek',
        'mistral',
        'openrouter',
        'transformers',
        'mock',
        'custom',
        'plugin'
    ];

    function getModelsForProvider(provider: LLMProvider) {
        if (provider === 'custom') {
            return Object.values($appSettings?.custom?.llm?.models ?? {}).sort((a, b) =>
                compareSortOrder(a.sortOrder, b.sortOrder)
            );
        }
        if (provider === 'plugin') {
            const allModels = pluginManager
                .getInstances()
                .flatMap((instance) => [...instance.llmProviders.values()].map((p) => p.model));
            const seen: Record<string, boolean> = {};
            return allModels.filter((model) => {
                if (seen[model.id]) return false;
                seen[model.id] = true;
                return true;
            });
        }
        return BUILT_IN_LLM_MODELS.filter((m) => m.provider === provider);
    }

    function getProviderApiKey(provider: LLMProvider): string {
        if (!$appSettings) return '';
        if (provider === 'mock' || provider === 'transformers' || provider === 'custom') return '';

        const key = provider as keyof AppSettings;
        const provConfig = $appSettings[key];
        if (provConfig && typeof provConfig === 'object' && 'apiKey' in provConfig) {
            return (provConfig as { apiKey?: string }).apiKey ?? '';
        }
        return '';
    }

    function handleApiKeyChange(provider: string, key: string) {
        updateSettings({
            [provider]: { apiKey: key.trim() }
        } as DeepPartial<AppSettings>);
    }

    function handleProviderChange(value: string): void {
        const provider = value as LLMProvider;
        onModelChange(provider, getModelsForProvider(provider)[0]?.id ?? '');
    }
</script>

{#snippet fields()}
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="flex flex-col gap-1.5">
            <Label>Provider</Label>
            <OptionSelect
                value={config.provider}
                options={providers.map((provider) => ({
                    value: provider,
                    label: getLLMProviderName(provider)
                }))}
                onChange={handleProviderChange}
            />
        </div>
        <div class="flex flex-col gap-1.5">
            <Label>Model</Label>
            <OptionSelect
                value={config.id}
                options={getModelsForProvider(config.provider).map((model) => ({
                    value: model.id,
                    label: model.name
                }))}
                onChange={(value) => onModelChange(config.provider, value)}
            />
        </div>

        {#if config.provider && !['mock', 'transformers', 'custom', 'plugin'].includes(config.provider)}
            <div class="flex flex-col gap-1.5 sm:col-span-2">
                <Label>
                    {getLLMProviderName(config.provider)} API Key
                </Label>
                <form onsubmit={(e) => e.preventDefault()} class="flex gap-2">
                    <Input
                        type={showKey ? 'text' : 'password'}
                        placeholder="Enter API Key"
                        value={getProviderApiKey(config.provider)}
                        oninput={(e) => handleApiKeyChange(config.provider, e.currentTarget.value)}
                        class="font-mono text-sm"
                        autocomplete="off"
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onclick={() => (showKey = !showKey)}
                        aria-label={showKey ? 'Hide API key' : 'Show API key'}
                    >
                        {#if showKey}<EyeOff class="size-4" />{:else}<Eye class="size-4" />{/if}
                    </Button>
                </form>
            </div>
        {/if}
    </div>
{/snippet}

<div class="flex flex-col gap-3">
    {@render fields()}
</div>
