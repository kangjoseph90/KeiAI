<script lang="ts">
    import {
        Plus,
        Trash2,
        Globe,
        Key,
        ChevronDown,
        ChevronRight,
        ChevronUp,
        GripVertical,
        Settings2
    } from 'lucide-svelte';
    import { SvelteSet } from 'svelte/reactivity';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import OptionSelect from '$lib/components/OptionSelect.svelte';
    import { Badge } from '$lib/components/ui/badge';
    import { appSettings, saveCustomLLMModel, deleteCustomLLMModel } from '$lib/stores';
    import {
        type LLMHandler,
        type LLMTokenizer,
        type LLMCapability,
        getLLMHandlerName,
        getLLMTokenizerName,
        getLLMCapabilityName
    } from '$lib/types/models/llm';
    import { generateSortOrder } from '$lib/utils/ordering';
    import { generateId } from '$lib/utils/id';
    import SortableList from '$lib/components/entitylist/SortableList.svelte';
    import EditableListItem from '$lib/components/entitylist/EditableListItem.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import ListActionBar from '$lib/components/ListActionBar.svelte';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    const expandedModels = new SvelteSet<string>();
    const expandedCapabilities = new SvelteSet<string>();
    let busyAction = $state<string | null>(null);

    const handlers: LLMHandler[] = ['openai_compatible', 'anthropic', 'google'];
    const capabilities: LLMCapability[] = [
        'image_input',
        'audio_input',
        'video_input',
        'streaming',
        'tool_call'
    ];

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
            expandedCapabilities.delete(id);
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

    function toggleCapabilities(id: string) {
        if (expandedCapabilities.has(id)) {
            expandedCapabilities.delete(id);
        } else {
            expandedCapabilities.add(id);
        }
    }

    function setCapability(
        id: string,
        unsupported: LLMCapability[] | undefined,
        capability: LLMCapability,
        enabled: boolean
    ): void {
        const next = enabled
            ? (unsupported ?? []).filter((item) => item !== capability)
            : [...new Set([...(unsupported ?? []), capability])];
        void updateModelSafely(id, { unsupported: next.length > 0 ? next : undefined });
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
            <EditableListItem expanded={expandedModels.has(model.id)} busy={busyAction !== null}>
                {#snippet header()}
                    <!-- 헤더 영역 -->
                    <div
                        class="flex h-7 w-4 shrink-0 cursor-grab active:cursor-grabbing select-none items-center justify-center text-muted-foreground/45 transition-colors hover:text-muted-foreground"
                        aria-hidden="true"
                    >
                        <GripVertical class="size-3.5" />
                    </div>
                    <button
                        type="button"
                        class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onclick={() => toggleExpand(model.id)}
                        aria-label={expandedModels.has(model.id) ? 'Collapse' : 'Expand'}
                    >
                        {#if expandedModels.has(model.id)}
                            <ChevronDown class="size-3.5" />
                        {:else}
                            <ChevronRight class="size-3.5" />
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
                        class="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 font-medium shadow-none focus-visible:ring-0 dark:bg-transparent text-sm leading-relaxed"
                    />

                    <Badge variant="secondary" class="text-[10px] h-5 px-1.5 shrink-0">
                        {getLLMHandlerName(model.handler)}
                    </Badge>

                    <Button
                        size="icon-sm"
                        variant="ghost"
                        class="shrink-0 text-muted-foreground hover:text-destructive"
                        onclick={() => handleRemove(model.id)}
                        aria-label="Delete model"
                        disabled={busyAction !== null}
                        aria-busy={busyAction === `delete:${model.id}`}
                    >
                        <Trash2 class="size-3.5" />
                    </Button>
                {/snippet}

                <!-- 펼쳐지는 바디 영역 -->
                {#snippet details()}
                    <div class="flex flex-col gap-3">
                        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                            <form onsubmit={(e) => e.preventDefault()}>
                                <Input
                                    type="password"
                                    value={model.apiKey ?? ''}
                                    disabled={busyAction !== null}
                                    placeholder="sk-..."
                                    class="h-8 text-xs bg-background"
                                    autocomplete="off"
                                    onchange={(e) =>
                                        updateModelSafely(model.id, {
                                            apiKey: e.currentTarget.value
                                        })}
                                />
                            </form>
                        </div>

                        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div class="flex flex-col gap-1.5">
                                <Label class="text-xs">Tokenizer</Label>
                                <OptionSelect
                                    id={`custom-model-tokenizer-${model.id}`}
                                    class="h-8 text-xs"
                                    value={model.tokenizer}
                                    disabled={busyAction !== null}
                                    options={tokenizers.map((tokenizer) => ({
                                        value: tokenizer,
                                        label: getLLMTokenizerName(tokenizer)
                                    }))}
                                    onChange={(value) =>
                                        updateModelSafely(model.id, {
                                            tokenizer: value as LLMTokenizer
                                        })}
                                />
                            </div>
                            <div class="flex flex-col gap-1.5">
                                <Label class="text-xs flex items-center gap-1">
                                    <Settings2 class="size-3" /> Format
                                </Label>
                                <OptionSelect
                                    id={`custom-model-handler-${model.id}`}
                                    class="h-8 text-xs"
                                    value={model.handler}
                                    disabled={busyAction !== null}
                                    options={handlers.map((handler) => ({
                                        value: handler,
                                        label: getLLMHandlerName(handler)
                                    }))}
                                    onChange={(value) =>
                                        updateModelSafely(model.id, {
                                            handler: value as LLMHandler
                                        })}
                                />
                            </div>
                        </div>

                        <div class="space-y-1.5">
                            <Button
                                variant="ghost"
                                size="sm"
                                class="w-full justify-between h-8 text-xs text-muted-foreground hover:bg-muted/50"
                                onclick={() => toggleCapabilities(model.id)}
                            >
                                Capabilities
                                {#if expandedCapabilities.has(model.id)}
                                    <ChevronUp class="size-3" />
                                {:else}
                                    <ChevronDown class="size-3" />
                                {/if}
                            </Button>

                            {#if expandedCapabilities.has(model.id)}
                                <div class="grid gap-3 p-3 rounded-lg bg-muted/30 border">
                                    <div class="flex flex-col gap-2">
                                        <div class="flex flex-wrap gap-x-5 gap-y-2">
                                            {#each capabilities as capability (capability)}
                                                <label class="flex items-center gap-2 text-xs">
                                                    <input
                                                        type="checkbox"
                                                        class="size-4 accent-primary"
                                                        checked={!model.unsupported?.includes(
                                                            capability
                                                        )}
                                                        disabled={busyAction !== null}
                                                        onchange={(event) =>
                                                            setCapability(
                                                                model.id,
                                                                model.unsupported,
                                                                capability,
                                                                event.currentTarget.checked
                                                            )}
                                                    />
                                                    {getLLMCapabilityName(capability)}
                                                </label>
                                            {/each}
                                        </div>
                                    </div>
                                </div>
                            {/if}
                        </div>
                    </div>
                {/snippet}
            </EditableListItem>
        {/snippet}
    </SortableList>
</div>
