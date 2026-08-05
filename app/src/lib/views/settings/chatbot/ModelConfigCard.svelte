<script lang="ts">
    import { Eye, EyeOff } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
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
</script>

{#snippet fields()}
    <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-1.5">
            <Label>Provider</Label>
            <select
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={config.provider}
                onchange={(e) => onModelChange(e.currentTarget.value as LLMProvider, '')}
            >
                {#each providers as provider (provider)}
                    <option value={provider}>{getLLMProviderName(provider)}</option>
                {/each}
            </select>
        </div>
        <div class="flex flex-col gap-1.5">
            <Label>Model</Label>
            <select
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={config.id}
                onchange={(e) => onModelChange(config.provider, e.currentTarget.value)}
            >
                <option value="">Select a model...</option>
                {#each getModelsForProvider(config.provider) as model (model.id)}
                    <option value={model.id}>{model.name}</option>
                {/each}
            </select>
        </div>
    </div>

    {#if config.provider && !['mock', 'transformers', 'custom', 'plugin'].includes(config.provider)}
        <Separator />
        <div class="flex flex-col gap-1.5">
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
{/snippet}

<div class="flex flex-col gap-3">
    {@render fields()}
</div>
