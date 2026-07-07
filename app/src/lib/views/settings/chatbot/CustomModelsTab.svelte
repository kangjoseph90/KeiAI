<script lang="ts">
    import { Plus, Trash2, Globe, Key, ChevronDown, ChevronRight, Settings2 } from 'lucide-svelte';
    import { SvelteSet } from 'svelte/reactivity';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Badge } from '$lib/components/ui/badge';
    import {
        appSettings,
        createCustomLLMModel,
        updateCustomLLMModel,
        deleteCustomLLMModel
    } from '$lib/stores';
    import {
        type LLMHandler,
        type LLMTokenizer,
        getLLMHandlerName,
        getLLMTokenizerName
    } from '$lib/types/models/llm';
    import { generateSortOrder } from '$lib/utils/ordering';
    import SortableList from '$lib/components/entitylist/SortableList.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import ListActionBar from '$lib/components/ListActionBar.svelte';

    let expandedModels = new SvelteSet();

    const handlers: LLMHandler[] = ['openai_compatible', 'anthropic', 'google'];

    const tokenizers: LLMTokenizer[] = [
        'o200k_base',
        'claude',
        'llama3',
        'deepseek',
        'gemma',
        'mistral'
    ];

    async function handleAddModel() {
        const models = Object.values($appSettings?.custom?.llm?.models ?? {});
        const modelId = await createCustomLLMModel({
            name: 'New Custom Model',
            modelId: '',
            baseUrl: '',
            apiKey: '',
            handler: 'openai_compatible',
            tokenizer: 'o200k_base',
            sortOrder: generateSortOrder(
                Object.fromEntries(
                    models.map((model) => [model.id, { id: model.id, sortOrder: model.sortOrder }])
                )
            )
        });

        const next = new SvelteSet(expandedModels);
        next.add(modelId);
        expandedModels = next;
    }

    async function handleRemove(id: string) {
        await deleteCustomLLMModel(id);
        const next = new SvelteSet(expandedModels);
        next.delete(id);
        expandedModels = next;
    }

    async function handleReorder(id: string, newSortOrder: string) {
        await updateCustomLLMModel(id, { sortOrder: newSortOrder });
    }

    function toggleExpand(id: string) {
        const next = new SvelteSet(expandedModels);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        expandedModels = next;
    }
</script>

<div class="flex flex-col gap-4 px-2">
    <ListActionBar description="Models from custom API endpoints.">
        <Button size="sm" class="gap-1.5" onclick={handleAddModel}>
            <Plus class="size-4" /> Add
        </Button>
    </ListActionBar>

    <SortableList
        entities={Object.values($appSettings?.custom?.llm?.models ?? {})}
        onReorder={handleReorder}
    >
        {#snippet empty()}
            <EmptyListPlaceholder message="No custom models registered yet." />
        {/snippet}
        {#snippet item({ entity: model })}
            <div
                class="group overflow-hidden rounded-xl border bg-card shadow-sm transition-[border-color,box-shadow,opacity] hover:border-border/80 hover:shadow-md"
            >
                <!-- 헤더 영역 -->
                <div class="flex min-h-14 items-center gap-2 px-3 py-2">
                    <button
                        type="button"
                        class="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        onclick={() => toggleExpand(model.id)}
                        aria-label={expandedModels.has(model.id) ? 'Collapse' : 'Expand'}
                    >
                        {#if expandedModels.has(model.id)}
                            <ChevronDown class="size-4" />
                        {:else}
                            <ChevronRight class="size-4" />
                        {/if}
                    </button>

                    <Input
                        value={model.name}
                        onchange={(e) =>
                            updateCustomLLMModel(model.id, {
                                name: e.currentTarget.value
                            })}
                        aria-label="Model name"
                        class="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 font-medium shadow-none focus-visible:ring-0 text-sm leading-relaxed"
                    />

                    <Badge variant="secondary" class="text-[10px] h-5 px-1.5 shrink-0">
                        {getLLMHandlerName(model.handler)}
                    </Badge>

                    <Button
                        size="icon"
                        variant="ghost"
                        class="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onclick={() => handleRemove(model.id)}
                        aria-label="Delete model"
                    >
                        <Trash2 class="size-4" />
                    </Button>
                </div>

                <!-- 펼쳐지는 바디 영역 -->
                {#if expandedModels.has(model.id)}
                    <div class="flex flex-col gap-4 border-t bg-muted/20 p-4">
                        <div class="grid grid-cols-2 gap-4">
                            <div class="flex flex-col gap-1.5">
                                <Label class="text-xs">Model ID (Internal)</Label>
                                <Input
                                    value={model.modelId}
                                    placeholder="e.g. llama-3-8b"
                                    class="h-8 text-xs bg-background"
                                    onchange={(e) =>
                                        updateCustomLLMModel(model.id, {
                                            modelId: e.currentTarget.value
                                        })}
                                />
                            </div>
                            <div class="flex flex-col gap-1.5">
                                <Label class="text-xs flex items-center gap-1">
                                    <Globe class="size-3" /> Base URL
                                </Label>
                                <Input
                                    value={model.baseUrl}
                                    placeholder="https://api.your-provider.com/v1"
                                    class="h-8 text-xs bg-background"
                                    onchange={(e) =>
                                        updateCustomLLMModel(model.id, {
                                            baseUrl: e.currentTarget.value
                                        })}
                                />
                            </div>
                        </div>

                        <div class="flex flex-col gap-1.5">
                            <Label class="text-xs flex items-center gap-1">
                                <Key class="size-3" /> API Key (Optional)
                            </Label>
                            <Input
                                type="password"
                                value={model.apiKey ?? ''}
                                placeholder="sk-..."
                                class="h-8 text-xs bg-background"
                                onchange={(e) =>
                                    updateCustomLLMModel(model.id, {
                                        apiKey: e.currentTarget.value
                                    })}
                            />
                        </div>

                        <div class="grid grid-cols-2 gap-4">
                            <div class="flex flex-col gap-1.5">
                                <Label class="text-xs">Tokenizer</Label>
                                <select
                                    class="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm"
                                    value={model.tokenizer}
                                    onchange={(e) =>
                                        updateCustomLLMModel(model.id, {
                                            tokenizer: e.currentTarget.value as LLMTokenizer
                                        })}
                                >
                                    {#each tokenizers as t (t)}
                                        <option value={t}>{getLLMTokenizerName(t)}</option>
                                    {/each}
                                </select>
                            </div>
                            <div class="flex flex-col gap-1.5">
                                <Label class="text-xs flex items-center gap-1">
                                    <Settings2 class="size-3" /> Format
                                </Label>
                                <select
                                    class="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm"
                                    value={model.handler}
                                    onchange={(e) =>
                                        updateCustomLLMModel(model.id, {
                                            handler: e.currentTarget.value as LLMHandler
                                        })}
                                >
                                    {#each handlers as h (h)}
                                        <option value={h}>{getLLMHandlerName(h)}</option>
                                    {/each}
                                </select>
                            </div>
                        </div>
                    </div>
                {/if}
            </div>
        {/snippet}
    </SortableList>
</div>
