<script lang="ts">
    /**
     * ChatBotSettings — Unified Model, Parameters, Prompt, and Preset management.
     * Refactored into sub-components for better maintainability.
     */
    import { Badge } from '$lib/components/ui/badge';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import { Button } from '$lib/components/ui/button';
    import { activePreset } from '$lib/stores';

    // Sub-components
    import ModelTab from './chatbot/ModelTab.svelte';
    import ParametersTab from './chatbot/ParametersTab.svelte';
    import PromptTab from './chatbot/PromptTab.svelte';
    import PresetsTab from './chatbot/PresetsTab.svelte';
    import CustomModelsTab from './chatbot/CustomModelsTab.svelte';

    type Tab = 'model' | 'parameters' | 'prompt' | 'presets' | 'custom';
    let activeTab = $state<Tab>('model');
</script>

<div class="flex flex-col h-full overflow-hidden">
    <!-- Header with Tabs -->
    <div class="flex items-center justify-between mb-6 shrink-0">
        <div class="flex items-center gap-1 bg-muted/50 p-1 rounded-lg">
            {#each ['model', 'parameters', 'prompt', 'presets', 'custom'] as tab (tab)}
                <button
                    class="px-4 py-1.5 text-sm font-medium rounded-md transition-colors {activeTab ===
                    tab
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'}"
                    onclick={() => (activeTab = tab as Tab)}
                >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
            {/each}
        </div>

        {#if $activePreset}
            <div class="flex items-center gap-2">
                <Badge variant="outline" class="font-mono text-xs">
                    {$activePreset.name}
                </Badge>
            </div>
        {/if}
    </div>

    {#if !$activePreset && activeTab !== 'presets'}
        <div class="flex flex-1 items-center justify-center text-center p-12">
            <div class="flex flex-col gap-4">
                <p class="text-muted-foreground">No active preset selected.</p>
                <Button onclick={() => (activeTab = 'presets')}>Go to Presets</Button>
            </div>
        </div>
    {:else}
        <ScrollArea class="flex-1 -mr-4 pr-4">
            <div class="flex flex-col gap-6 pb-8">
                {#if activeTab === 'model'}
                    <ModelTab preset={$activePreset!} />
                {:else if activeTab === 'parameters'}
                    <ParametersTab preset={$activePreset!} />
                {:else if activeTab === 'prompt'}
                    <PromptTab preset={$activePreset!} />
                {:else if activeTab === 'presets'}
                    <PresetsTab />
                {:else if activeTab === 'custom'}
                    <CustomModelsTab />
                {/if}
            </div>
        </ScrollArea>
    {/if}
</div>
