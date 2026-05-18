<script lang="ts">
    import { Eye, EyeOff } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
    import { Badge } from '$lib/components/ui/badge';
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

    interface Props {
        title: string;
        badge: string;
        config: LLMModelConfig;
        onModelChange: (provider: LLMProvider, modelId: string) => void;
    }

    let { title, badge, config, onModelChange }: Props = $props();

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
            return $appSettings?.custom?.llm?.models || [];
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

<Card>
    <CardHeader>
        <CardTitle class="text-base flex items-center justify-between">
            {title}
            <Badge variant={badge === 'Generation' ? 'secondary' : 'outline'}>{badge}</Badge>
        </CardTitle>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
        <div class="grid grid-cols-2 gap-4">
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
                <Label class="flex items-center justify-between">
                    {getLLMProviderName(config.provider)} API Key
                    <span class="text-[10px] text-muted-foreground uppercase">Settings</span>
                </Label>
                <div class="flex gap-2">
                    <Input
                        type={showKey ? 'text' : 'password'}
                        placeholder="Enter API Key"
                        value={getProviderApiKey(config.provider)}
                        oninput={(e) => handleApiKeyChange(config.provider, e.currentTarget.value)}
                        class="font-mono text-sm"
                    />
                    <Button
                        variant="ghost"
                        size="sm"
                        onclick={() => (showKey = !showKey)}
                        aria-label={showKey ? 'Hide API key' : 'Show API key'}
                    >
                        {#if showKey}<EyeOff class="size-4" />{:else}<Eye class="size-4" />{/if}
                    </Button>
                </div>
            </div>
        {/if}
    </CardContent>
</Card>
