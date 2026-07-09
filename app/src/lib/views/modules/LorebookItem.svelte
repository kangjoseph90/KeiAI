<script lang="ts">
    import type { Lorebook } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Badge } from '$lib/components/ui/badge';
    import { Label } from '$lib/components/ui/label';
    import {
        ChevronDown,
        ChevronRight,
        ChevronUp,
        Eye,
        EyeOff,
        GripVertical,
        Trash2,
        Zap
    } from 'lucide-svelte';
    import type { LLMRole } from '$lib/types/models/llm';

    let {
        item,
        initiallyEditing = false,
        onUpdate,
        onDelete
    }: {
        item: Lorebook;
        initiallyEditing?: boolean;
        onUpdate: (id: string, changes: DeepPartial<Lorebook>) => void | Promise<void>;
        onDelete: (id: string) => void | Promise<void>;
    } = $props();

    let expanded = $state(false);
    let advancedOpen = $state(false);
    let openedInitially = $state(false);

    $effect(() => {
        if (initiallyEditing && !openedInitially) {
            openedInitially = true;
            expanded = true;
        }
    });
</script>

<div
    class="group overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition-[border-color,box-shadow,opacity] hover:border-border/80 hover:shadow-md {item.disabled
        ? 'opacity-55'
        : ''}"
>
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
            onclick={() => (expanded = !expanded)}
            aria-label={expanded ? 'Collapse entry' : 'Expand entry'}
        >
            {#if expanded}
                <ChevronDown class="size-4" />
            {:else}
                <ChevronRight class="size-4" />
            {/if}
        </button>

        <Input
            value={item.name}
            aria-label="Entry name"
            class="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 font-medium shadow-none focus-visible:ring-0 text-sm leading-relaxed"
            onchange={(e) => onUpdate(item.id, { name: e.currentTarget.value })}
        />

        {#if item.disabled}
            <Badge variant="outline" class="text-xs shrink-0">Disabled</Badge>
        {/if}

        <!-- 버튼 1: Always Active (Zap) -->
        <Button
            size="icon"
            variant="ghost"
            class="size-8 shrink-0 {item.alwaysActive
                ? 'text-amber-500 hover:text-amber-600'
                : 'text-muted-foreground'}"
            title={item.alwaysActive ? 'Deactivate Always Active' : 'Activate Always Active'}
            aria-label={item.alwaysActive ? 'Deactivate Always Active' : 'Activate Always Active'}
            onclick={() => onUpdate(item.id, { alwaysActive: !item.alwaysActive })}
        >
            <Zap class="size-4 {item.alwaysActive ? 'fill-amber-500/10' : ''}" />
        </Button>

        <!-- 버튼 2: Enabled / Disabled (Eye) -->
        <Button
            size="icon"
            variant="ghost"
            class="size-8 shrink-0 text-muted-foreground"
            title={item.disabled ? 'Enable entry' : 'Disable entry'}
            aria-label={item.disabled ? 'Enable entry' : 'Disable entry'}
            onclick={() => onUpdate(item.id, { disabled: !item.disabled })}
        >
            {#if !item.disabled}
                <Eye class="size-4" />
            {:else}
                <EyeOff class="size-4" />
            {/if}
        </Button>

        <!-- 버튼 3: Delete (Trash2) -->
        <Button
            size="icon"
            variant="ghost"
            class="size-8 shrink-0 text-muted-foreground hover:text-destructive"
            title="Delete entry"
            aria-label="Delete entry"
            onclick={() => onDelete(item.id)}
        >
            <Trash2 class="size-4" />
        </Button>
    </div>

    {#if expanded}
        <div class="flex flex-col gap-4 border-t bg-muted/20 p-4">
            <div class="flex flex-wrap gap-4 select-none">
                <label class="flex items-center gap-2 cursor-pointer text-xs">
                    <input
                        type="checkbox"
                        class="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                        checked={item.alwaysActive}
                        onchange={(e) =>
                            onUpdate(item.id, { alwaysActive: e.currentTarget.checked })}
                    />
                    <span>Always Active</span>
                </label>
            </div>

            {#if !item.alwaysActive}
                <div class="grid gap-3 sm:grid-cols-2">
                    <div class="space-y-1.5">
                        <Label class="text-xs">Key</Label>
                        <Input
                            class="h-8 font-mono text-sm"
                            value={item.key}
                            placeholder="keyword1, keyword2..."
                            onchange={(e) => onUpdate(item.id, { key: e.currentTarget.value })}
                        />
                    </div>
                    {#if item.useMultipleKeys && !item.useRegex}
                        <div class="space-y-1.5">
                            <Label class="text-xs">Second Key</Label>
                            <Input
                                class="h-8 font-mono text-sm"
                                value={item.secondKey}
                                placeholder="Must also match..."
                                onchange={(e) =>
                                    onUpdate(item.id, { secondKey: e.currentTarget.value })}
                            />
                        </div>
                    {/if}
                </div>
            {/if}

            <div class="space-y-1.5">
                <Label class="text-xs">Content</Label>
                <Textarea
                    class="text-sm min-h-[100px] font-sans bg-background"
                    value={item.content}
                    placeholder="Fact or lore to insert..."
                    onchange={(e) => onUpdate(item.id, { content: e.currentTarget.value })}
                />
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
                <div class="space-y-1.5">
                    <Label class="text-xs">Depth</Label>
                    <Input
                        class="h-8 text-sm"
                        type="number"
                        value={item.depth}
                        onchange={(e) =>
                            onUpdate(item.id, { depth: parseInt(e.currentTarget.value) || 0 })}
                    />
                </div>
                <div class="space-y-1.5">
                    <Label class="text-xs">Order</Label>
                    <Input
                        class="h-8 text-sm"
                        type="number"
                        value={item.order}
                        onchange={(e) =>
                            onUpdate(item.id, { order: parseInt(e.currentTarget.value) || 0 })}
                    />
                </div>
            </div>

            <div class="space-y-1.5">
                <Button
                    variant="ghost"
                    size="sm"
                    class="w-full justify-between h-8 text-xs text-muted-foreground hover:bg-muted/50"
                    onclick={() => (advancedOpen = !advancedOpen)}
                >
                    Advanced Settings
                    {#if advancedOpen}
                        <ChevronUp class="size-3" />
                    {:else}
                        <ChevronDown class="size-3" />
                    {/if}
                </Button>

                {#if advancedOpen}
                    <div class="grid gap-4 p-4 rounded-lg bg-muted/30 border">
                        <div class="grid gap-3 sm:grid-cols-2">
                            <div class="space-y-1.5">
                                <Label class="text-xs">Insertion Role</Label>
                                <select
                                    class="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    value={item.role}
                                    onchange={(e) =>
                                        onUpdate(item.id, {
                                            role: e.currentTarget.value as LLMRole
                                        })}
                                >
                                    <option value="system">System</option>
                                    <option value="user">User</option>
                                    <option value="assistant">Assistant</option>
                                </select>
                            </div>
                            <div class="space-y-1.5">
                                <Label class="text-xs">Probability (%)</Label>
                                <Input
                                    class="h-8 text-sm"
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={item.probability}
                                    onchange={(e) =>
                                        onUpdate(item.id, {
                                            probability: parseInt(e.currentTarget.value) || 0
                                        })}
                                />
                            </div>
                        </div>

                        <div class="space-y-3">
                            <div class="flex items-center gap-2 select-none">
                                <input
                                    type="checkbox"
                                    class="size-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                                    checked={item.scanDepth !== undefined}
                                    id="scanDepthToggle"
                                    onchange={(e) =>
                                        onUpdate(item.id, {
                                            scanDepth: e.currentTarget.checked ? 5 : undefined
                                        })}
                                />
                                <Label
                                    for="scanDepthToggle"
                                    class="text-xs font-medium cursor-pointer">Scan Depth</Label
                                >
                                {#if item.scanDepth !== undefined}
                                    <Input
                                        class="h-7 w-20 ml-2 text-xs"
                                        type="number"
                                        value={item.scanDepth}
                                        onchange={(e) =>
                                            onUpdate(item.id, {
                                                scanDepth: parseInt(e.currentTarget.value) || 5
                                            })}
                                    />
                                {/if}
                            </div>

                            <div class="grid grid-cols-2 gap-y-3 gap-x-2 select-none">
                                <label class="flex items-center gap-2 cursor-pointer text-xs">
                                    <input
                                        type="checkbox"
                                        class="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                                        checked={item.useRegex}
                                        onchange={(e) => {
                                            const checked = e.currentTarget.checked;
                                            onUpdate(item.id, {
                                                useRegex: checked,
                                                useMultipleKeys: checked
                                                    ? false
                                                    : item.useMultipleKeys
                                            });
                                        }}
                                    />
                                    <span>Use Regex</span>
                                </label>
                                <label class="flex items-center gap-2 cursor-pointer text-xs">
                                    <input
                                        type="checkbox"
                                        class="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                                        checked={item.useMultipleKeys}
                                        disabled={item.useRegex}
                                        onchange={(e) =>
                                            onUpdate(item.id, {
                                                useMultipleKeys: e.currentTarget.checked
                                            })}
                                    />
                                    <span>Require second key</span>
                                </label>
                                <label class="flex items-center gap-2 cursor-pointer text-xs">
                                    <input
                                        type="checkbox"
                                        class="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                                        checked={item.recursive}
                                        onchange={(e) =>
                                            onUpdate(item.id, {
                                                recursive: e.currentTarget.checked
                                            })}
                                    />
                                    <span>Recursive</span>
                                </label>
                                <label class="flex items-center gap-2 cursor-pointer text-xs">
                                    <input
                                        type="checkbox"
                                        class="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                                        checked={item.noRecursiveSearch}
                                        onchange={(e) =>
                                            onUpdate(item.id, {
                                                noRecursiveSearch: e.currentTarget.checked
                                            })}
                                    />
                                    <span>No Recursive Search</span>
                                </label>
                            </div>
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>
