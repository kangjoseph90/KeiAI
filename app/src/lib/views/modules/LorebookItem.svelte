<script lang="ts">
    import type { Lorebook } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Badge } from '$lib/components/ui/badge';
    import { Label } from '$lib/components/ui/label';
    import { Check, Pencil, Trash2, ChevronDown, ChevronUp } from 'lucide-svelte';
    import type { LLMRole } from '$lib/types/models/llm';

    let {
        item,
        onUpdate,
        onDelete
    }: {
        item: Lorebook;
        onUpdate: (id: string, changes: DeepPartial<Lorebook>) => void | Promise<void>;
        onDelete: (id: string) => void | Promise<void>;
    } = $props();

    let editing = $state(false);
    let advancedOpen = $state(false);

    let editName = $state('');
    let editKey = $state('');
    let editSecondKey = $state('');
    let editContent = $state('');
    let editDepth = $state(0);
    let editOrder = $state(100);
    let editAlwaysActive = $state(false);
    let editDisabled = $state(false);

    // Advanced fields
    let editRole = $state<LLMRole>('system');
    let editUseRegex = $state(false);
    let editUseMultipleKeys = $state(false);
    let editScanDepthEnabled = $state(false);
    let editScanDepth = $state<number>(5);
    let editProbability = $state(100);
    let editRecursive = $state(false);
    let editNoRecursiveSearch = $state(false);

    function startEdit() {
        editName = item.name;
        editKey = item.key;
        editSecondKey = item.secondKey;
        editContent = item.content;
        editDepth = item.depth;
        editOrder = item.order;
        editAlwaysActive = item.alwaysActive;
        editDisabled = item.disabled;

        editRole = item.role;
        editUseRegex = item.useRegex;
        editUseMultipleKeys = item.useMultipleKeys;
        editScanDepthEnabled = item.scanDepth !== undefined;
        editScanDepth = item.scanDepth ?? 5;
        editProbability = item.probability;
        editRecursive = item.recursive;
        editNoRecursiveSearch = item.noRecursiveSearch;

        editing = true;
    }

    async function handleSave() {
        if (!editName.trim()) return;
        await onUpdate(item.id, {
            name: editName,
            key: editKey,
            secondKey: editSecondKey,
            content: editContent,
            depth: editDepth,
            order: editOrder,
            alwaysActive: editAlwaysActive,
            disabled: editDisabled,
            role: editRole,
            useRegex: editUseRegex,
            useMultipleKeys: editUseRegex ? false : editUseMultipleKeys,
            scanDepth: editScanDepthEnabled ? editScanDepth : undefined,
            probability: editProbability,
            recursive: editRecursive,
            noRecursiveSearch: editNoRecursiveSearch
        });
        editing = false;
    }

    function getDisplayKeys(text: string): string[] {
        return text
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean);
    }
</script>

<div class="rounded-md border bg-card text-card-foreground shadow-sm">
    {#if editing}
        <div class="p-4 flex flex-col gap-4">
            <!-- Basic Section -->
            <div class="grid gap-4 sm:grid-cols-2">
                <div class="space-y-2">
                    <Label class="text-xs uppercase tracking-wider text-muted-foreground"
                        >Name</Label
                    >
                    <Input class="h-8 text-sm" bind:value={editName} placeholder="Entry name..." />
                </div>
                <div class="flex items-end gap-4 pb-1">
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            class="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                            bind:checked={editDisabled}
                        />
                        <span class="text-xs font-medium">Disabled</span>
                    </label>
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            class="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                            bind:checked={editAlwaysActive}
                        />
                        <span class="text-xs font-medium">Always Active</span>
                    </label>
                </div>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
                <div class="space-y-2">
                    <Label class="text-xs uppercase tracking-wider text-muted-foreground">Key</Label
                    >
                    <Input
                        class="h-8 font-mono text-sm"
                        bind:value={editKey}
                        placeholder="keyword1, keyword2..."
                    />
                </div>
                {#if editUseMultipleKeys && !editUseRegex}
                    <div class="space-y-2">
                        <Label class="text-xs uppercase tracking-wider text-muted-foreground"
                            >Second Key</Label
                        >
                        <Input
                            class="h-8 font-mono text-sm"
                            bind:value={editSecondKey}
                            placeholder="Must also match..."
                        />
                    </div>
                {/if}
            </div>

            <div class="space-y-2">
                <Label class="text-xs uppercase tracking-wider text-muted-foreground">Content</Label
                >
                <Textarea
                    class="text-xs min-h-[100px] font-sans"
                    bind:value={editContent}
                    placeholder="Fact or lore to insert..."
                />
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
                <div class="space-y-2">
                    <Label class="text-xs uppercase tracking-wider text-muted-foreground"
                        >Depth</Label
                    >
                    <Input class="h-8 text-sm" type="number" bind:value={editDepth} />
                </div>
                <div class="space-y-2">
                    <Label class="text-xs uppercase tracking-wider text-muted-foreground"
                        >Order</Label
                    >
                    <Input class="h-8 text-sm" type="number" bind:value={editOrder} />
                </div>
            </div>

            <!-- Advanced Section Toggle -->
            <Button
                variant="ghost"
                size="sm"
                class="w-full justify-between h-8 text-xs text-muted-foreground"
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
                <div class="grid gap-6 p-4 rounded-lg bg-muted/30 border">
                    <div class="grid gap-4 sm:grid-cols-2">
                        <div class="space-y-2">
                            <Label class="text-xs">Insertion Role</Label>
                            <select
                                class="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                bind:value={editRole}
                            >
                                <option value="system">System</option>
                                <option value="user">User</option>
                                <option value="assistant">Assistant</option>
                            </select>
                        </div>
                        <div class="space-y-2">
                            <Label class="text-xs">Probability (%)</Label>
                            <Input
                                class="h-8 text-sm"
                                type="number"
                                min="0"
                                max="100"
                                bind:value={editProbability}
                            />
                        </div>
                    </div>

                    <div class="space-y-3">
                        <div class="flex items-center gap-2">
                            <input
                                type="checkbox"
                                class="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                                bind:checked={editScanDepthEnabled}
                                id="scanDepthToggle"
                            />
                            <Label for="scanDepthToggle" class="text-xs font-medium"
                                >Scan Depth</Label
                            >
                            {#if editScanDepthEnabled}
                                <Input
                                    class="h-7 w-20 ml-2 text-xs"
                                    type="number"
                                    bind:value={editScanDepth}
                                />
                            {/if}
                        </div>

                        <div class="grid grid-cols-2 gap-y-3">
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    class="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                                    bind:checked={editUseRegex}
                                />
                                <span class="text-xs">Use Regex</span>
                            </label>
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    class="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                                    bind:checked={editUseMultipleKeys}
                                />
                                <span class="text-xs">Require second key</span>
                            </label>
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    class="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                                    bind:checked={editRecursive}
                                />
                                <span class="text-xs">Recursive</span>
                            </label>
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    class="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                                    bind:checked={editNoRecursiveSearch}
                                />
                                <span class="text-xs">No Recursive Search</span>
                            </label>
                        </div>
                    </div>
                </div>
            {/if}

            <div class="flex gap-2 pt-2">
                <Button size="sm" class="gap-1.5 h-8 flex-1 text-sm" onclick={handleSave}>
                    <Check class="size-3.5" /> Save Entry
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    class="h-8 text-sm"
                    onclick={() => {
                        editing = false;
                        advancedOpen = false;
                    }}
                >
                    Cancel
                </Button>
            </div>
        </div>
    {:else}
        <div class="p-3 flex items-start justify-between gap-4">
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-semibold tracking-tight"
                        >{item.name || 'Unnamed'}</span
                    >
                    {#if item.disabled}
                        <Badge variant="destructive" class="text-[9px] h-4 uppercase px-1"
                            >Disabled</Badge
                        >
                    {/if}
                    {#if item.alwaysActive}
                        <Badge variant="default" class="text-[9px] h-4 uppercase px-1"
                            >Always Active</Badge
                        >
                    {/if}
                    <div class="flex items-center gap-1 ml-auto sm:ml-0">
                        <span class="text-[10px] text-muted-foreground font-mono"
                            >D:{item.depth}</span
                        >
                        <span class="text-[10px] text-muted-foreground font-mono"
                            >O:{item.order}</span
                        >
                        <Badge variant="outline" class="text-[9px] h-4 uppercase px-1 font-bold"
                            >{item.role}</Badge
                        >
                    </div>
                </div>

                <div class="flex flex-wrap gap-1.5 mt-2">
                    {#each getDisplayKeys(item.key) as key (key)}
                        <Badge variant="secondary" class="text-[10px] h-5 py-0 font-mono"
                            >{key}</Badge
                        >
                    {/each}
                    {#if item.useMultipleKeys && item.secondKey && !item.useRegex}
                        <span class="text-muted-foreground text-[10px] self-center">&</span>
                        {#each getDisplayKeys(item.secondKey) as key (key)}
                            <Badge
                                variant="outline"
                                class="text-[10px] h-5 py-0 font-mono border-primary/30"
                                >{key}</Badge
                            >
                        {/each}
                    {/if}
                </div>
            </div>

            <div class="flex gap-1 shrink-0">
                <Button
                    size="icon"
                    variant="ghost"
                    class="size-8 text-muted-foreground hover:text-foreground"
                    onclick={startEdit}
                >
                    <Pencil class="size-4" />
                </Button>
                <Button
                    size="icon"
                    variant="ghost"
                    class="size-8 text-muted-foreground hover:text-destructive"
                    onclick={() => onDelete(item.id)}
                >
                    <Trash2 class="size-4" />
                </Button>
            </div>
        </div>
    {/if}
</div>
