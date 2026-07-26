<script lang="ts">
    import {
        Bot,
        BookOpen,
        ChevronDown,
        ChevronRight,
        Eye,
        EyeOff,
        GripVertical,
        MessageSquareText,
        MessagesSquare,
        Plus,
        Workflow,
        Trash2
    } from 'lucide-svelte';
    import { SvelteSet } from 'svelte/reactivity';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Textarea } from '$lib/components/ui/textarea';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
    import SortableList from '$lib/components/entitylist/SortableList.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import WorkflowNumberField from './WorkflowNumberField.svelte';
    import WorkflowStringField from './WorkflowStringField.svelte';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { generateSortOrder } from '$lib/utils/ordering';
    import type { LLMRole } from '$lib/types/models/llm';
    import { appConfirm } from '$lib/ui';
    import {
        createBlock,
        deleteBlock,
        updateBlock,
        type AgentNode,
        type PromptBlock,
        type WorkflowDefinition,
        type WorkflowEditResult
    } from '$lib/workflow';

    interface Props {
        workflow: WorkflowDefinition;
        selectedNodeId: string | null;
        onSelectNode: (nodeId: string) => void;
        onEdit: (result: WorkflowEditResult) => void | Promise<void>;
        onEditWorkflow: () => void;
        workflowLabel?: string;
        editWorkflowLabel?: string;
    }

    let {
        workflow,
        selectedNodeId,
        onSelectNode,
        onEdit,
        onEditWorkflow,
        workflowLabel = 'Workflow',
        editWorkflowLabel = 'Edit workflow'
    }: Props = $props();
    let expandedBlocks = $state<Set<string>>(new Set());
    let deletingBlockId = $state<string | null>(null);

    const agents = $derived(
        Object.values(workflow.nodes).filter((node): node is AgentNode => node.class === 'Agent')
    );
    const agent = $derived(
        selectedNodeId && workflow.nodes[selectedNodeId]?.class === 'Agent'
            ? (workflow.nodes[selectedNodeId] as AgentNode)
            : (agents[0] ?? null)
    );
    const blocks = $derived(agent?.promptBlocks ?? {});
    const blockCount = $derived(Object.keys(blocks).length);

    async function applyBlockEdit(blockId: string, changes: DeepPartial<PromptBlock>) {
        if (!agent) return;
        await onEdit(updateBlock(workflow, agent.id, blockId, changes));
    }

    function addBlock() {
        if (!agent) return;
        const sortOrder = generateSortOrder(
            Object.fromEntries(
                Object.values(blocks).map((block) => [
                    block.id,
                    { id: block.id, sortOrder: block.sortOrder }
                ])
            )
        );
        return onEdit(
            createBlock(workflow, agent.id, {
                name: 'New Block',
                type: 'text',
                role: 'system',
                content: '',
                sortOrder
            })
        );
    }

    function changeBlockType(blockId: string, type: PromptBlock['type']) {
        switch (type) {
            case 'text':
                return applyBlockEdit(blockId, { type, role: 'system', content: '' });
            case 'history':
                return applyBlockEdit(blockId, { type, historyMode: 'visible' });
            case 'lorebook':
                return applyBlockEdit(blockId, { type });
        }
    }

    function toggleBlock(blockId: string) {
        const next = new SvelteSet(expandedBlocks);
        if (next.has(blockId)) next.delete(blockId);
        else next.add(blockId);
        expandedBlocks = next;
    }

    async function removeBlock(block: PromptBlock) {
        if (!agent || deletingBlockId) return;
        const agentId = agent.id;
        deletingBlockId = block.id;
        try {
            const confirmed = await appConfirm({
                title: 'Delete prompt block?',
                description: `Delete "${block.name}" from this prompt?`,
                confirmText: 'Delete',
                variant: 'destructive'
            });
            if (!confirmed || agent?.id !== agentId) return;
            await onEdit(deleteBlock(workflow, agentId, block.id));
        } finally {
            deletingBlockId = null;
        }
    }
</script>

<div class="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4">
    <section
        class="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3"
    >
        <div class="flex min-w-0 items-center gap-3">
            <Workflow class="size-5 shrink-0 text-muted-foreground" />
            <div class="min-w-0">
                <p class="text-sm font-medium">{workflowLabel}</p>
                <p class="text-[11px] text-muted-foreground/70">
                    {agents.length} agent{agents.length === 1 ? '' : 's'}
                </p>
            </div>
        </div>
        <Button size="sm" variant="outline" onclick={onEditWorkflow}>
            <Workflow class="size-4" />
            {editWorkflowLabel}
        </Button>
    </section>

    <section class="flex min-h-0 flex-1 flex-col gap-3">
        {#if agent}
            <div
                class="flex flex-col gap-4 rounded-xl border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-3"
            >
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:min-w-0 sm:flex-1">
                    <div class="flex items-center gap-3">
                        <Bot class="size-5 shrink-0 text-muted-foreground" />
                        <div class="min-w-0">
                            <p class="text-sm font-medium">Agent prompt</p>
                            <p class="text-[11px] text-muted-foreground/70">
                                {blockCount} block{blockCount === 1 ? '' : 's'}
                            </p>
                        </div>
                    </div>
                    <div class="flex w-full items-center gap-2 sm:w-auto">
                        <select
                            id="workflow-agent"
                            aria-label="Agent"
                            class="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm font-medium shadow-sm sm:w-52 sm:flex-initial"
                            value={agent.id}
                            onchange={(event) => onSelectNode(event.currentTarget.value)}
                        >
                            {#each agents as item (item.id)}
                                <option value={item.id}>{item.name}</option>
                            {/each}
                        </select>
                        <div
                            class="flex h-9 shrink-0 items-center gap-2 rounded-lg border bg-background px-3 text-xs shadow-sm"
                            title="Selected agent LLM type"
                        >
                            <span class="text-muted-foreground">LLM</span>
                            <span class="max-w-36 truncate font-mono font-medium"
                                >{agent.llmType}</span
                            >
                        </div>
                    </div>
                </div>
                <div class="flex shrink-0 items-center gap-2 sm:mt-0">
                    <Button size="sm" class="w-full sm:w-auto" onclick={addBlock}
                        ><Plus class="size-4" /> Add block</Button
                    >
                </div>
            </div>

            <div class="min-h-0 flex-1">
                <SortableList
                    entities={Object.values(blocks)}
                    onReorder={(id, sortOrder) => applyBlockEdit(id, { sortOrder })}
                >
                    {#snippet item({ entity: block })}
                        <div
                            class="group overflow-hidden rounded-xl border bg-card shadow-sm transition-[border-color,box-shadow,opacity] hover:border-border/80 hover:shadow-md {block.enabled
                                ? ''
                                : 'opacity-55'}"
                        >
                            <div class="flex min-h-14 items-center gap-2 px-3 py-2">
                                <div
                                    class="flex h-8 w-5 shrink-0 cursor-grab active:cursor-grabbing select-none items-center justify-center text-muted-foreground/45 transition-colors hover:text-muted-foreground"
                                    aria-hidden="true"
                                >
                                    <GripVertical class="size-4" />
                                </div>
                                <button
                                    class="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                    onclick={() => toggleBlock(block.id)}
                                    aria-label={expandedBlocks.has(block.id)
                                        ? 'Collapse block'
                                        : 'Expand block'}
                                >
                                    {#if expandedBlocks.has(block.id)}
                                        <ChevronDown class="size-4" />
                                    {:else}
                                        <ChevronRight class="size-4" />
                                    {/if}
                                </button>

                                <DropdownMenu.Root>
                                    <DropdownMenu.Trigger>
                                        <button
                                            type="button"
                                            class="flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-muted/80 {block.type ===
                                            'text'
                                                ? 'bg-violet-500/10 text-violet-600 dark:text-violet-300'
                                                : block.type === 'history'
                                                  ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300'
                                                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-300'}"
                                            aria-label="Change block type"
                                        >
                                            {#if block.type === 'text'}
                                                <MessageSquareText class="size-4" />
                                            {:else if block.type === 'history'}
                                                <MessagesSquare class="size-4" />
                                            {:else}
                                                <BookOpen class="size-4" />
                                            {/if}
                                        </button>
                                    </DropdownMenu.Trigger>
                                    <DropdownMenu.Content align="start">
                                        <DropdownMenu.Item
                                            onclick={() => changeBlockType(block.id, 'text')}
                                        >
                                            <MessageSquareText
                                                class="mr-2 size-4 text-violet-500"
                                            />
                                            <span>Text</span>
                                        </DropdownMenu.Item>
                                        <DropdownMenu.Item
                                            onclick={() => changeBlockType(block.id, 'history')}
                                        >
                                            <MessagesSquare class="mr-2 size-4 text-sky-500" />
                                            <span>History</span>
                                        </DropdownMenu.Item>
                                        <DropdownMenu.Item
                                            onclick={() => changeBlockType(block.id, 'lorebook')}
                                        >
                                            <BookOpen class="mr-2 size-4 text-amber-500" />
                                            <span>Lorebook</span>
                                        </DropdownMenu.Item>
                                    </DropdownMenu.Content>
                                </DropdownMenu.Root>

                                <Input
                                    value={block.name}
                                    aria-label="Block name"
                                    class="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 font-medium shadow-none focus-visible:ring-0"
                                    oninput={(e) =>
                                        applyBlockEdit(block.id, { name: e.currentTarget.value })}
                                />
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    class="size-8 shrink-0 text-muted-foreground"
                                    title={block.enabled ? 'Disable block' : 'Enable block'}
                                    aria-label={block.enabled ? 'Disable block' : 'Enable block'}
                                    onclick={() =>
                                        applyBlockEdit(block.id, { enabled: !block.enabled })}
                                >
                                    {#if block.enabled}
                                        <Eye class="size-4" />
                                    {:else}
                                        <EyeOff class="size-4" />
                                    {/if}
                                </Button>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    class="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                                    title="Delete block"
                                    aria-label="Delete block"
                                    disabled={deletingBlockId !== null}
                                    aria-busy={deletingBlockId === block.id}
                                    onclick={() => removeBlock(block)}
                                    ><Trash2 class="size-4" /></Button
                                >
                            </div>

                            {#if expandedBlocks.has(block.id)}
                                <div class="flex flex-col gap-4 border-t bg-muted/20 p-4">
                                    {#if block.type === 'text'}
                                        <div class="space-y-1.5">
                                            <Label class="text-xs">Role</Label>
                                            <select
                                                aria-label="Message role"
                                                class="h-8 w-28 rounded-lg border bg-background px-2 text-xs font-medium shadow-sm"
                                                value={block.role}
                                                onchange={(e) =>
                                                    applyBlockEdit(block.id, {
                                                        role: e.currentTarget.value as LLMRole
                                                    })}
                                            >
                                                <option value="system">System</option>
                                                <option value="user">User</option>
                                                <option value="assistant">Assistant</option>
                                            </select>
                                        </div>
                                        <div class="space-y-1.5">
                                            <Label class="text-xs">Content</Label>
                                            <Textarea
                                                value={block.content}
                                                rows={7}
                                                class="min-h-40 resize-y bg-background font-mono text-sm leading-relaxed"
                                                placeholder="Write prompt text. Macros are supported."
                                                oninput={(e) =>
                                                    applyBlockEdit(block.id, {
                                                        content: e.currentTarget.value
                                                    })}
                                            />
                                        </div>
                                    {:else if block.type === 'history'}
                                        <div class="grid grid-cols-2 gap-3">
                                            <WorkflowStringField
                                                label="Start"
                                                value={block.start}
                                                inputmode="numeric"
                                                onchange={(value) =>
                                                    applyBlockEdit(block.id, { start: value })}
                                            />
                                            <WorkflowStringField
                                                label="End"
                                                value={block.end}
                                                inputmode="numeric"
                                                onchange={(value) =>
                                                    applyBlockEdit(block.id, { end: value })}
                                            />
                                        </div>
                                        <div class="space-y-1.5">
                                            <Label class="text-xs">History content</Label>
                                            <select
                                                class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                                value={block.historyMode}
                                                onchange={(event) =>
                                                    applyBlockEdit(block.id, {
                                                        historyMode: event.currentTarget.value as
                                                            | 'last_text'
                                                            | 'visible'
                                                            | 'full_trace'
                                                    })}
                                            >
                                                <option value="last_text">Last text part</option>
                                                <option value="visible">Visible parts</option>
                                                <option value="full_trace">Full trace</option>
                                            </select>
                                        </div>
                                        <div class="space-y-1.5">
                                            <Label class="text-xs">Message format</Label>
                                            <Textarea
                                                value={block.format ?? ''}
                                                placeholder="Custom format"
                                                rows={5}
                                                class="resize-y bg-background font-mono text-sm leading-relaxed"
                                                oninput={(e) =>
                                                    applyBlockEdit(block.id, {
                                                        format: e.currentTarget.value || undefined
                                                    })}
                                            />
                                        </div>
                                    {:else}
                                        <div class="grid grid-cols-2 gap-3">
                                            <WorkflowNumberField
                                                label="Min Depth"
                                                value={block.minDepth}
                                                onchange={(value) =>
                                                    applyBlockEdit(block.id, { minDepth: value })}
                                            />
                                            <WorkflowNumberField
                                                label="Max Depth"
                                                value={block.maxDepth}
                                                onchange={(value) =>
                                                    applyBlockEdit(block.id, { maxDepth: value })}
                                            />
                                        </div>
                                        <label
                                            class="flex w-fit items-center gap-2 text-xs select-none cursor-pointer"
                                            ><input
                                                type="checkbox"
                                                checked={block.reverseOrder ?? false}
                                                onchange={(e) =>
                                                    applyBlockEdit(block.id, {
                                                        reverseOrder: e.currentTarget.checked
                                                    })}
                                            />Reverse insertion order</label
                                        >
                                        <div class="space-y-1.5">
                                            <Label class="text-xs">Entry format</Label>
                                            <Textarea
                                                value={block.format ?? ''}
                                                placeholder="Custom format"
                                                rows={5}
                                                class="resize-y bg-background font-mono text-sm leading-relaxed"
                                                oninput={(e) =>
                                                    applyBlockEdit(block.id, {
                                                        format: e.currentTarget.value || undefined
                                                    })}
                                            />
                                        </div>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    {/snippet}

                    {#snippet empty()}
                        <EmptyListPlaceholder message="No prompt blocks." />
                    {/snippet}
                </SortableList>
            </div>
        {:else}
            <div
                class="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground"
            >
                <MessageSquareText class="size-8 opacity-40" />
                This workflow has no Agent node.
            </div>
        {/if}
    </section>
</div>
