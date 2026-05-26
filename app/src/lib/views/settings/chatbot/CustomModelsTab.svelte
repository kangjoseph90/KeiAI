<script lang="ts">
    import {
        Plus,
        Trash2,
        Settings2,
        Globe,
        Key,
        Tag,
        ChevronDown,
        ChevronRight
    } from 'lucide-svelte';
    import { SvelteSet } from 'svelte/reactivity';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Card, CardContent } from '$lib/components/ui/card';
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
        type CustomLLMModel,
        getLLMHandlerName,
        getLLMTokenizerName
    } from '$lib/types/models/llm';
    import { generateSortOrder } from '$lib/utils/ordering';
    import SortableList from '$lib/components/entitylist/SortableList.svelte';

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

    function modelSummary(model: CustomLLMModel): string {
        const endpoint = model.baseUrl.trim() || 'No base URL';
        const providerModel = model.modelId.trim() || 'No provider model id';
        return `${providerModel} · ${endpoint}`;
    }
</script>

<div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
        <h4 class="text-sm font-medium flex items-center gap-2">
            <Tag class="size-4" /> Registered Custom Models
        </h4>
        <Button size="sm" variant="outline" class="h-8 gap-1.5" onclick={handleAddModel}>
            <Plus class="size-3.5" /> Add Model
        </Button>
    </div>

    <SortableList
        entities={Object.values($appSettings?.custom?.llm?.models ?? {})}
        onReorder={handleReorder}
    >
        {#snippet empty()}
            <div
                class="p-8 text-center border-2 border-dashed rounded-lg text-muted-foreground text-sm"
            >
                No custom models registered yet.
            </div>
        {/snippet}
        {#snippet item({ entity: model })}
            <Card class="my-1 py-3">
                <CardContent class="p-2.5 flex flex-col gap-3">
                    <div class="flex items-center justify-between gap-3">
                        <div class="flex items-center gap-2 flex-1 min-w-0">
                            <button
                                class="shrink-0 rounded hover:bg-muted p-0.5"
                                onclick={() => toggleExpand(model.id)}
                                aria-label={expandedModels.has(model.id) ? 'Collapse' : 'Expand'}
                            >
                                {#if expandedModels.has(model.id)}
                                    <ChevronDown class="size-3.5 text-muted-foreground" />
                                {:else}
                                    <ChevronRight class="size-3.5 text-muted-foreground" />
                                {/if}
                            </button>
                            <Input
                                value={model.name}
                                oninput={(e) =>
                                    updateCustomLLMModel(model.id, {
                                        name: e.currentTarget.value
                                    })}
                                class="h-7 font-medium border-none bg-transparent hover:bg-muted/50 focus:bg-muted/50 px-2 text-xs"
                            />
                            <Badge variant="secondary" class="text-[10px] h-5 px-1.5 shrink-0">
                                {getLLMHandlerName(model.handler)}
                            </Badge>
                        </div>
                        <div class="flex items-center gap-1 shrink-0">
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                class="text-destructive hover:text-destructive"
                                onclick={() => handleRemove(model.id)}
                                aria-label="Delete model"
                            >
                                <Trash2 class="size-3.5" />
                            </Button>
                        </div>
                    </div>

                    {#if !expandedModels.has(model.id)}
                        <div class="pl-6 text-[10px] text-muted-foreground font-mono truncate">
                            {modelSummary(model)}
                        </div>
                    {:else}
                        <div class="grid gap-3 pl-6">
                            <div class="grid grid-cols-2 gap-4">
                                <div class="flex flex-col gap-1.5">
                                    <Label class="text-xs">Model ID (Internal)</Label>
                                    <Input
                                        value={model.modelId}
                                        placeholder="e.g. llama-3-8b"
                                        oninput={(e) =>
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
                                        oninput={(e) =>
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
                                    oninput={(e) =>
                                        updateCustomLLMModel(model.id, {
                                            apiKey: e.currentTarget.value
                                        })}
                                />
                            </div>

                            <div class="grid grid-cols-2 gap-4">
                                <div class="flex flex-col gap-1.5">
                                    <Label class="text-xs">Tokenizer</Label>
                                    <select
                                        class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
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
                                        class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
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
                </CardContent>
            </Card>
        {/snippet}
    </SortableList>
</div>
