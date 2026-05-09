<script lang="ts">
    import { Trash2, Plus, GripVertical } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Card, CardContent } from '$lib/components/ui/card';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Label } from '$lib/components/ui/label';
    import { createPromptBlock, updatePromptBlock, deletePromptBlock } from '$lib/stores';
    import { type LLMRole } from '$lib/types/models/llm';
    import { generateSortOrder } from '$lib/utils/ordering';
    import type { DeepPartial } from '$lib/utils/defaults';
    import type { Preset, PromptBlock, PromptBlockFields } from '$lib/services/content/preset';

    interface Props {
        preset: Preset;
    }

    let { preset }: Props = $props();

    const sortedBlocks = $derived(() => {
        return Object.values(preset.promptBlocks).sort((a, b) =>
            a.sortOrder.localeCompare(b.sortOrder)
        );
    });

    async function handleAddBlock() {
        const blocks = Object.values(preset.promptBlocks);
        await createPromptBlock(preset.id, {
            name: 'New Block',
            type: 'text',
            role: 'system',
            content: '',
            sortOrder: generateSortOrder(
                Object.fromEntries(blocks.map((b) => [b.id, { id: b.id, sortOrder: b.sortOrder }]))
            )
        });
    }

    async function moveBlock(id: string, direction: 'up' | 'down') {
        const blocks = sortedBlocks();
        const idx = blocks.findIndex((b) => b.id === id);
        if (idx === -1) return;

        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= blocks.length) return;

        const current = blocks[idx];
        const target = blocks[targetIdx];

        await updatePromptBlock(preset.id, current.id, { sortOrder: target.sortOrder });
        await updatePromptBlock(preset.id, target.id, { sortOrder: current.sortOrder });
    }

    function changeBlockType(blockId: string, type: PromptBlock['type']) {
        const oldBlock = preset.promptBlocks[blockId];
        const base = { name: oldBlock.name, type };

        let update: Partial<PromptBlockFields> = base;

        if (type === 'text') {
            update = { ...base, role: 'system', content: '' };
        } else if (type === 'history') {
            update = { ...base, start: undefined, end: undefined };
        } else if (type === 'lorebook') {
            update = { ...base, minDepth: undefined, maxDepth: undefined, reverseOrder: false };
        } else {
            update = { ...base, role: 'system' };
        }

        updatePromptBlock(preset.id, blockId, update as DeepPartial<PromptBlock>);
    }
</script>

<div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
        <h4 class="text-sm font-medium">Prompt Construction Blocks</h4>
        <Button size="sm" variant="outline" class="h-8 gap-1.5" onclick={handleAddBlock}>
            <Plus class="size-3.5" /> Add Block
        </Button>
    </div>

    <div class="flex flex-col gap-3">
        {#each sortedBlocks() as block (block.id)}
            <Card class={!block.enabled ? 'opacity-60' : ''}>
                <CardContent class="p-4 flex flex-col gap-4">
                    <!-- Header -->
                    <div class="flex items-center justify-between gap-4">
                        <div class="flex items-center gap-3 flex-1">
                            <div class="flex flex-col gap-0.5 shrink-0">
                                <button
                                    class="h-4 w-4 flex items-center justify-center hover:bg-muted rounded"
                                    onclick={() => moveBlock(block.id, 'up')}
                                    aria-label="Move block up"
                                >
                                    <GripVertical class="size-3 text-muted-foreground rotate-90" />
                                </button>
                                <button
                                    class="h-4 w-4 flex items-center justify-center hover:bg-muted rounded"
                                    onclick={() => moveBlock(block.id, 'down')}
                                    aria-label="Move block down"
                                >
                                    <GripVertical class="size-3 text-muted-foreground -rotate-90" />
                                </button>
                            </div>
                            <Input
                                value={block.name}
                                oninput={(e) =>
                                    updatePromptBlock(preset.id, block.id, {
                                        name: e.currentTarget.value
                                    })}
                                class="h-8 font-medium border-none bg-transparent hover:bg-muted/50 focus:bg-muted/50 px-2"
                            />

                            {#if 'role' in block}
                                <select
                                    class="h-7 text-[10px] rounded border bg-muted/30 px-1 uppercase font-bold"
                                    value={block.role}
                                    onchange={(e) =>
                                        updatePromptBlock(preset.id, block.id, {
                                            role: e.currentTarget.value as LLMRole
                                        })}
                                >
                                    <option value="system">System</option>
                                    <option value="user">User</option>
                                    <option value="assistant">Assistant</option>
                                </select>
                            {/if}

                            <select
                                class="h-7 text-[10px] rounded border bg-muted/30 px-1 uppercase"
                                value={block.type}
                                onchange={(e) =>
                                    changeBlockType(
                                        block.id,
                                        e.currentTarget.value as PromptBlock['type']
                                    )}
                            >
                                <option value="text">Text</option>
                                <option value="character">Character</option>
                                <option value="persona">Persona</option>
                                <option value="lorebook">Lorebook</option>
                                <option value="memory">Memory</option>
                                <option value="history">History</option>
                                <option value="characterNote">Char Note</option>
                                <option value="chatNote">Chat Note</option>
                            </select>
                        </div>
                        <div class="flex items-center gap-1">
                            <button
                                class="h-7 w-7 flex items-center justify-center rounded hover:bg-muted"
                                onclick={() =>
                                    updatePromptBlock(preset.id, block.id, {
                                        enabled: !block.enabled
                                    })}
                                aria-label={block.enabled ? 'Disable block' : 'Enable block'}
                            >
                                <div
                                    class="size-3 rounded-full {block.enabled
                                        ? 'bg-primary'
                                        : 'bg-muted-foreground/30'}"
                                ></div>
                            </button>
                            <Button
                                variant="ghost"
                                size="sm"
                                class="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                onclick={() => deletePromptBlock(preset.id, block.id)}
                                aria-label="Delete block"
                            >
                                <Trash2 class="size-3.5" />
                            </Button>
                        </div>
                    </div>

                    <!-- Content / Settings -->
                    <div class="grid gap-3 pl-7">
                        {#if block.type === 'text'}
                            <div class="space-y-2">
                                <Textarea
                                    value={block.content}
                                    oninput={(e) =>
                                        updatePromptBlock(preset.id, block.id, {
                                            content: e.currentTarget.value
                                        })}
                                    placeholder="Enter prompt content..."
                                    class="text-xs min-h-[80px] font-mono leading-relaxed"
                                />
                            </div>
                        {:else if block.type === 'history'}
                            <div class="grid grid-cols-2 gap-x-6 gap-y-3">
                                <div class="space-y-1.5">
                                    <label class="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            class="size-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                                            checked={block.start !== undefined}
                                            onchange={(e) =>
                                                updatePromptBlock(preset.id, block.id, {
                                                    start: e.currentTarget.checked ? 0 : undefined
                                                })}
                                        />
                                        <span class="text-[10px] text-muted-foreground uppercase"
                                            >Start Offset</span
                                        >
                                    </label>
                                    {#if block.start !== undefined}
                                        <Input
                                            type="number"
                                            value={block.start}
                                            oninput={(e) =>
                                                updatePromptBlock(preset.id, block.id, {
                                                    start: parseInt(e.currentTarget.value)
                                                })}
                                            class="h-8 text-xs"
                                        />
                                    {:else}
                                        <div
                                            class="h-8 flex items-center px-3 border rounded bg-muted/20 text-[10px] italic text-muted-foreground"
                                        >
                                            Elastic / Unbounded
                                        </div>
                                    {/if}
                                </div>
                                <div class="space-y-1.5">
                                    <label class="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            class="size-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                                            checked={block.end !== undefined}
                                            onchange={(e) =>
                                                updatePromptBlock(preset.id, block.id, {
                                                    end: e.currentTarget.checked ? 0 : undefined
                                                })}
                                        />
                                        <span class="text-[10px] text-muted-foreground uppercase"
                                            >End Offset</span
                                        >
                                    </label>
                                    {#if block.end !== undefined}
                                        <Input
                                            type="number"
                                            value={block.end}
                                            oninput={(e) =>
                                                updatePromptBlock(preset.id, block.id, {
                                                    end: parseInt(e.currentTarget.value)
                                                })}
                                            class="h-8 text-xs"
                                        />
                                    {:else}
                                        <div
                                            class="h-8 flex items-center px-3 border rounded bg-muted/20 text-[10px] italic text-muted-foreground"
                                        >
                                            To Latest / End
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        {:else if block.type === 'lorebook'}
                            <div class="grid grid-cols-2 gap-x-6 gap-y-3">
                                <div class="space-y-1.5">
                                    <label class="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            class="size-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                                            checked={block.minDepth !== undefined}
                                            onchange={(e) =>
                                                updatePromptBlock(preset.id, block.id, {
                                                    minDepth: e.currentTarget.checked
                                                        ? 0
                                                        : undefined
                                                })}
                                        />
                                        <span class="text-[10px] text-muted-foreground uppercase"
                                            >Min Depth</span
                                        >
                                    </label>
                                    {#if block.minDepth !== undefined}
                                        <Input
                                            type="number"
                                            value={block.minDepth}
                                            oninput={(e) =>
                                                updatePromptBlock(preset.id, block.id, {
                                                    minDepth: parseInt(e.currentTarget.value)
                                                })}
                                            class="h-8 text-xs"
                                        />
                                    {:else}
                                        <div
                                            class="h-8 flex items-center px-3 border rounded bg-muted/20 text-[10px] italic text-muted-foreground"
                                        >
                                            Default
                                        </div>
                                    {/if}
                                </div>
                                <div class="space-y-1.5">
                                    <label class="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            class="size-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                                            checked={block.maxDepth !== undefined}
                                            onchange={(e) =>
                                                updatePromptBlock(preset.id, block.id, {
                                                    maxDepth: e.currentTarget.checked
                                                        ? 10
                                                        : undefined
                                                })}
                                        />
                                        <span class="text-[10px] text-muted-foreground uppercase"
                                            >Max Depth</span
                                        >
                                    </label>
                                    {#if block.maxDepth !== undefined}
                                        <Input
                                            type="number"
                                            value={block.maxDepth}
                                            oninput={(e) =>
                                                updatePromptBlock(preset.id, block.id, {
                                                    maxDepth: parseInt(e.currentTarget.value)
                                                })}
                                            class="h-8 text-xs"
                                        />
                                    {:else}
                                        <div
                                            class="h-8 flex items-center px-3 border rounded bg-muted/20 text-[10px] italic text-muted-foreground"
                                        >
                                            Default
                                        </div>
                                    {/if}
                                </div>
                                <div class="col-span-2 flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="reverseOrder-{block.id}"
                                        class="size-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                                        checked={block.reverseOrder}
                                        onchange={(e) =>
                                            updatePromptBlock(preset.id, block.id, {
                                                reverseOrder: e.currentTarget.checked
                                            })}
                                    />
                                    <Label for="reverseOrder-{block.id}" class="text-xs"
                                        >Reverse Order</Label
                                    >
                                </div>
                            </div>
                        {:else}
                            <div
                                class="bg-muted/30 rounded p-2 text-[10px] text-muted-foreground italic"
                            >
                                Dynamic block: {block.type}
                            </div>
                        {/if}

                        <!-- Custom Format -->
                        {#if block.type !== 'text'}
                            <div class="pt-2 border-t mt-1">
                                <div class="flex items-center justify-between mb-2">
                                    <label class="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            class="size-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                                            checked={block.format !== undefined}
                                            onchange={(e) =>
                                                updatePromptBlock(preset.id, block.id, {
                                                    format: e.currentTarget.checked ? '' : undefined
                                                })}
                                        />
                                        <span class="text-[10px] font-medium"
                                            >Use Custom Format</span
                                        >
                                    </label>
                                </div>
                                {#if block.format !== undefined}
                                    <Textarea
                                        value={block.format}
                                        oninput={(e) =>
                                            updatePromptBlock(preset.id, block.id, {
                                                format: e.currentTarget.value
                                            })}
                                        placeholder={'{{slot}}'}
                                        class="text-[10px] min-h-[40px] font-mono"
                                    />
                                {/if}
                            </div>
                        {/if}
                    </div>
                </CardContent>
            </Card>
        {/each}
    </div>
</div>
