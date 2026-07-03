<script lang="ts">
    import { Badge } from '$lib/components/ui/badge';
    import { Button } from '$lib/components/ui/button';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import { activePreset } from '$lib/stores';
    import ModelTab from './chatbot/ModelTab.svelte';
    import ParametersTab from './chatbot/ParametersTab.svelte';
    import CustomModelsTab from './chatbot/CustomModelsTab.svelte';

    type Tab = 'model' | 'parameters' | 'custom';
    let activeTab = $state<Tab>('model');
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div class="mb-6 flex min-w-0 shrink-0 items-center justify-between gap-2">
        <div class="flex min-w-0 overflow-x-auto rounded-lg bg-muted/50 p-1">
            {#each ['model', 'parameters', 'custom'] as tab (tab)}
                <button
                    class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors {activeTab ===
                    tab
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'}"
                    onclick={() => (activeTab = tab as Tab)}
                >
                    {tab === 'custom'
                        ? 'Custom Models'
                        : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
            {/each}
        </div>

        {#if $activePreset}
            <Badge variant="outline" class="hidden font-mono text-xs sm:inline-flex"
                >{$activePreset.name}</Badge
            >
        {/if}
    </div>

    {#if !$activePreset && activeTab !== 'custom'}
        <div class="flex flex-1 items-center justify-center p-12 text-center">
            <div class="flex flex-col gap-4">
                <p class="text-muted-foreground">No active preset selected.</p>
                <Button onclick={() => (activeTab = 'custom')}>Manage Custom Models</Button>
            </div>
        </div>
    {:else}
        <ScrollArea class="-mr-4 min-h-0 flex-1 pr-4">
            <div class="flex flex-col gap-6 pb-8">
                {#if activeTab === 'model'}
                    <ModelTab preset={$activePreset!} />
                {:else if activeTab === 'parameters'}
                    <ParametersTab preset={$activePreset!} />
                {:else}
                    <CustomModelsTab />
                {/if}
            </div>
        </ScrollArea>
    {/if}
</div>
