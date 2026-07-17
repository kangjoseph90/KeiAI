<script lang="ts">
    import {
        Plus,
        Trash2,
        Globe,
        Key,
        ChevronDown,
        ChevronRight,
        GripVertical,
        Settings2
    } from 'lucide-svelte';
    import { SvelteSet } from 'svelte/reactivity';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Badge } from '$lib/components/ui/badge';
    import { appSettings, saveCustomLLMModel, deleteCustomLLMModel } from '$lib/stores';
    import {
        type LLMHandler,
        type LLMTokenizer,
        getLLMHandlerName,
        getLLMTokenizerName
    } from '$lib/types/models/llm';
    import { generateSortOrder } from '$lib/utils/ordering';
    import { generateId } from '$lib/utils/id';
    import SortableList from '$lib/components/entitylist/SortableList.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import ListActionBar from '$lib/components/ListActionBar.svelte';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    const expandedModels = new SvelteSet<string>();
    let busyAction = $state<string | null>(null);

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
        if (busyAction) return;
        busyAction = 'create';
        try {
            const models = Object.values($appSettings?.custom?.llm?.models ?? {});
            const modelId = `custom::${generateId()}`;
            await saveCustomLLMModel(modelId, {
                name: 'New Custom Model',
                modelId: '',
                baseUrl: '',
                apiKey: '',
                handler: 'openai_compatible',
                tokenizer: 'o200k_base',
                sortOrder: generateSortOrder(
                    Object.fromEntries(
                        models.map((model) => [
                            model.id,
                            { id: model.id, sortOrder: model.sortOrder }
                        ])
                    )
                )
            });
            expandedModels.add(modelId);
        } catch (error) {
            toast.error({ title: 'Could not add model', description: getErrorMessage(error) });
        } finally {
            busyAction = null;
        }
    }

    async function handleRemove(id: string) {
        if (busyAction) return;
        busyAction = `delete:${id}`;
        try {
            const model = $appSettings?.custom?.llm?.models?.[id];
            const confirmed = await appConfirm({
                title: 'Delete custom model?',
                description: `Delete "${model?.name ?? 'this custom model'}"? Presets that reference it may need to be updated.`,
                confirmText: 'Delete',
                variant: 'destructive'
            });
            if (!confirmed) return;
            await deleteCustomLLMModel(id);
            expandedModels.delete(id);
        } catch (error) {
            toast.error({ title: 'Could not delete model', description: getErrorMessage(error) });
        } finally {
            busyAction = null;
        }
    }

    async function handleReorder(id: string, newSortOrder: string) {
        if (busyAction) return;
        try {
            await saveCustomLLMModel(id, { sortOrder: newSortOrder });
        } catch (error) {
            toast.error({ title: 'Could not reorder model', description: getErrorMessage(error) });
        }
    }

    async function updateModelSafely(
        id: string,
        changes: Parameters<typeof saveCustomLLMModel>[1]
    ): Promise<void> {
        try {
            await saveCustomLLMModel(id, changes);
        } catch (error) {
            toast.error({ title: 'Could not update model', description: getErrorMessage(error) });
        }
    }

    function toggleExpand(id: string) {
        if (expandedModels.has(id)) {
            expandedModels.delete(id);
        } else {
            expandedModels.add(id);
        }
    }
</script>

<div class="flex flex-col gap-4 px-2">
    <ListActionBar description="Models from custom API endpoints.">
        <Button
            size="sm"
            class="gap-1.5"
            disabled={busyAction !== null}
            aria-busy={busyAction === 'create'}
            onclick={handleAddModel}
        >
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
                    <div
                        class="flex h-8 w-5 shrink-0 cursor-grab active:cursor-grabbing select-none items-center justify-center text-muted-foreground/45 transition-colors hover:text-muted-foreground"
                        aria-hidden="true"
                    >
                        <GripVertical class="size-4" />
                    </div>
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
                        disabled={busyAction !== null}
                        onchange={(e) =>
                            updateModelSafely(model.id, {
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
                        disabled={busyAction !== null}
                        aria-busy={busyAction === `delete:${model.id}`}
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
                                    disabled={busyAction !== null}
                                    placeholder="e.g. llama-3-8b"
                                    class="h-8 text-xs bg-background"
                                    onchange={(e) =>
                                        updateModelSafely(model.id, {
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
                                    disabled={busyAction !== null}
                                    placeholder="https://api.your-provider.com/v1"
                                    class="h-8 text-xs bg-background"
                                    onchange={(e) =>
                                        updateModelSafely(model.id, {
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
                                disabled={busyAction !== null}
                                placeholder="sk-..."
                                class="h-8 text-xs bg-background"
                                onchange={(e) =>
                                    updateModelSafely(model.id, {
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
                                    disabled={busyAction !== null}
                                    onchange={(e) =>
                                        updateModelSafely(model.id, {
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
                                    disabled={busyAction !== null}
                                    onchange={(e) =>
                                        updateModelSafely(model.id, {
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
