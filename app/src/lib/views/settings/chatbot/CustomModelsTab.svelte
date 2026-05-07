<script lang="ts">
    import { Plus, Trash2, Settings2, Globe, Key, Tag } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
    import { Badge } from '$lib/components/ui/badge';
    import { Separator } from '$lib/components/ui/separator';
    import { appSettings, updateSettings } from '$lib/stores';
    import {
        type LLMHandler,
        type LLMTokenizer,
        type CustomLLMModel,
        getLLMHandlerName,
        getLLMTokenizerName
    } from '$lib/types/models/llm';
    import type { AppSettings } from '$lib/services/content/settings';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { generateId } from '$lib/utils/id';

    let editingModelId = $state<string | null>(null);
    let newModel = $state<Partial<CustomLLMModel>>({
        name: '',
        modelId: '',
        baseUrl: '',
        apiKey: '',
        handler: 'openai_compatible',
        tokenizer: 'o200k_base',
        flags: ['streaming']
    });

    const handlers: LLMHandler[] = ['openai_compatible', 'anthropic', 'google'];

    const tokenizers: LLMTokenizer[] = [
        'o200k_base',
        'claude',
        'llama3',
        'deepseek',
        'gemma',
        'mistral'
    ];

    async function handleAddOrUpdate() {
        if (!newModel.name?.trim() || !newModel.modelId?.trim() || !newModel.baseUrl?.trim())
            return;

        const currentModels = $appSettings?.custom?.llm?.models || [];
        const models = [...currentModels];

        const modelData: CustomLLMModel = {
            ...$state.snapshot(newModel),
            id: editingModelId || `custom::${generateId()}`,
            name: newModel.name.trim(),
            modelId: newModel.modelId.trim(),
            baseUrl: newModel.baseUrl.trim(),
            provider: 'custom',
            flags: newModel.flags || ['streaming']
        } as CustomLLMModel;

        if (editingModelId) {
            const idx = models.findIndex((m) => m.id === editingModelId);
            if (idx !== -1) {
                models[idx] = modelData;
            }
        } else {
            models.push(modelData);
        }

        await updateSettings({
            custom: {
                llm: {
                    models: $state.snapshot(models)
                }
            }
        } as DeepPartial<AppSettings>);

        resetForm();
    }

    async function handleRemove(id: string) {
        const models = ($appSettings?.custom?.llm?.models || []).filter((m) => m.id !== id);
        await updateSettings({
            custom: { llm: { models: $state.snapshot(models) } }
        } as DeepPartial<AppSettings>);
    }

    function handleEdit(model: CustomLLMModel) {
        editingModelId = model.id;
        newModel = { ...model };
    }

    function resetForm() {
        editingModelId = null;
        newModel = {
            name: '',
            modelId: '',
            baseUrl: '',
            apiKey: '',
            handler: 'openai_compatible',
            tokenizer: 'o200k_base',
            flags: ['streaming']
        };
    }
</script>

<div class="flex flex-col gap-6">
    <!-- Editor Card -->
    <Card class="border-primary/20 shadow-sm">
        <CardHeader class="pb-3">
            <CardTitle class="text-base flex items-center gap-2">
                <Settings2 class="size-4 text-primary" />
                {editingModelId ? 'Edit Custom Model' : 'Add Custom Model'}
            </CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
            <div class="grid grid-cols-2 gap-4">
                <div class="flex flex-col gap-1.5">
                    <Label class="text-xs">Display Name</Label>
                    <Input bind:value={newModel.name} placeholder="e.g. My Local LLM" />
                </div>
                <div class="flex flex-col gap-1.5">
                    <Label class="text-xs">Model ID (Internal)</Label>
                    <Input bind:value={newModel.modelId} placeholder="e.g. llama-3-8b" />
                </div>
            </div>

            <div class="flex flex-col gap-1.5">
                <Label class="text-xs flex items-center gap-1">
                    <Globe class="size-3" /> Base URL
                </Label>
                <Input
                    bind:value={newModel.baseUrl}
                    placeholder="https://api.your-provider.com/v1"
                />
            </div>

            <div class="flex flex-col gap-1.5">
                <Label class="text-xs flex items-center gap-1">
                    <Key class="size-3" /> API Key (Optional)
                </Label>
                <Input type="password" bind:value={newModel.apiKey} placeholder="sk-..." />
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div class="flex flex-col gap-1.5">
                    <Label class="text-xs">API Handler</Label>
                    <select
                        class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                        bind:value={newModel.handler}
                    >
                        {#each handlers as h (h)}
                            <option value={h}>{getLLMHandlerName(h)}</option>
                        {/each}
                    </select>
                </div>
                <div class="flex flex-col gap-1.5">
                    <Label class="text-xs">Tokenizer</Label>
                    <select
                        class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                        bind:value={newModel.tokenizer}
                    >
                        {#each tokenizers as t (t)}
                            <option value={t}>{getLLMTokenizerName(t)}</option>
                        {/each}
                    </select>
                </div>
            </div>

            <div class="flex justify-end gap-2 pt-2">
                {#if editingModelId}
                    <Button variant="ghost" size="sm" onclick={resetForm}>Cancel</Button>
                {/if}
                <Button
                    size="sm"
                    onclick={handleAddOrUpdate}
                    disabled={!newModel.name || !newModel.modelId || !newModel.baseUrl}
                >
                    {editingModelId ? 'Update Model' : 'Add Model'}
                </Button>
            </div>
        </CardContent>
    </Card>

    <Separator />

    <!-- List -->
    <div class="flex flex-col gap-3">
        <h4 class="text-sm font-medium flex items-center gap-2">
            <Tag class="size-4" /> Registered Custom Models
        </h4>

        {#if ($appSettings?.custom?.llm?.models || []).length === 0}
            <div
                class="p-8 text-center border-2 border-dashed rounded-lg text-muted-foreground text-sm"
            >
                No custom models registered yet.
            </div>
        {:else}
            <div class="grid grid-cols-1 gap-3">
                {#each $appSettings?.custom?.llm?.models || [] as model (model.id)}
                    <div
                        class="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                    >
                        <div class="flex flex-col gap-1">
                            <div class="flex items-center gap-2">
                                <span class="font-medium text-sm">{model.name}</span>
                                <Badge variant="secondary" class="text-[10px] h-4 px-1"
                                    >{getLLMHandlerName(model.handler)}</Badge
                                >
                            </div>
                            <div
                                class="text-[10px] text-muted-foreground font-mono truncate max-w-[300px]"
                            >
                                {model.baseUrl}
                            </div>
                        </div>
                        <div class="flex items-center gap-1">
                            <Button
                                variant="ghost"
                                size="sm"
                                class="h-8 w-8 p-0"
                                onclick={() => handleEdit(model)}
                            >
                                <Settings2 class="size-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                class="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                onclick={() => handleRemove(model.id)}
                            >
                                <Trash2 class="size-4" />
                            </Button>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</div>
