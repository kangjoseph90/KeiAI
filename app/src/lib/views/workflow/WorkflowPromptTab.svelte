<script lang="ts">
    import {
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
    import { Textarea } from '$lib/components/ui/textarea';
    import SortableList from '$lib/components/entitylist/SortableList.svelte';
    import WorkflowNumberField from './WorkflowNumberField.svelte';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { generateSortOrder } from '$lib/utils/ordering';
    import type { LLMRole } from '$lib/types/models/llm';
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
        onEditWorkflow?: () => void;
        editWorkflowLabel?: string;
    }

    let {
        workflow,
        selectedNodeId,
        onSelectNode,
        onEdit,
        onEditWorkflow,
        editWorkflowLabel = 'Edit agent workflow'
    }: Props = $props();
    let expandedBlocks = $state<Set<string>>(new Set());

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
        return applyBlockEdit(blockId, { type } as DeepPartial<PromptBlock>);
    }

    function toggleBlock(blockId: string) {
        const next = new SvelteSet(expandedBlocks);
        if (next.has(blockId)) next.delete(blockId);
        else next.add(blockId);
        expandedBlocks = next;
    }
</script>

<div class="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-3">
    {#if agent}
        <div
            class="flex shrink-0 flex-wrap items-center justify-between gap-4 rounded-xl border bg-muted/30 px-4 py-3"
        >
            <div class="flex min-w-0 flex-wrap items-center gap-3">
                <div class="min-w-0">
                    <p class="text-xs font-medium text-muted-foreground">Agent prompt</p>
                    <p class="text-[11px] text-muted-foreground/70">
                        {blockCount} block{blockCount === 1 ? '' : 's'}
                    </p>
                </div>
                <select
                    id="workflow-agent"
                    aria-label="Agent"
                    class="h-9 min-w-52 rounded-lg border bg-background px-3 text-sm font-medium shadow-sm"
                    value={agent.id}
                    onchange={(event) => onSelectNode(event.currentTarget.value)}
                >
                    {#each agents as item (item.id)}
                        <option value={item.id}>{item.name}</option>
                    {/each}
                </select>
                <div
                    class="flex h-9 items-center gap-2 rounded-lg border bg-background px-3 text-xs shadow-sm"
                    title="Selected agent LLM type"
                >
                    <span class="text-muted-foreground">LLM</span>
                    <span class="max-w-36 truncate font-mono font-medium">{agent.llmType}</span>
                </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
                {#if onEditWorkflow}
                    <Button size="sm" variant="outline" onclick={onEditWorkflow}>
                        <Workflow class="size-4" />
                        {editWorkflowLabel}
                    </Button>
                {/if}
                <Button size="sm" onclick={addBlock}><Plus class="size-4" /> Add block</Button>
            </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto pr-2">
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
                            <GripVertical
                                class="size-4 shrink-0 cursor-grab text-muted-foreground/40 group-hover:text-muted-foreground active:cursor-grabbing"
                            />
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

                            <div
                                class="flex size-8 shrink-0 items-center justify-center rounded-lg {block.type ===
                                'text'
                                    ? 'bg-violet-500/10 text-violet-600 dark:text-violet-300'
                                    : block.type === 'history'
                                      ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300'
                                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-300'}"
                            >
                                {#if block.type === 'text'}
                                    <MessageSquareText class="size-4" />
                                {:else if block.type === 'history'}
                                    <MessagesSquare class="size-4" />
                                {:else}
                                    <BookOpen class="size-4" />
                                {/if}
                            </div>

                            <Input
                                value={block.name}
                                aria-label="Block name"
                                class="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 font-medium shadow-none focus-visible:ring-0"
                                oninput={(e) =>
                                    applyBlockEdit(block.id, { name: e.currentTarget.value })}
                            />
                            <select
                                aria-label="Block type"
                                class="h-8 w-28 rounded-lg border bg-background px-2 text-xs font-medium"
                                value={block.type}
                                onchange={(e) =>
                                    changeBlockType(
                                        block.id,
                                        e.currentTarget.value as PromptBlock['type']
                                    )}
                            >
                                <option value="text">Text</option>
                                <option value="history">History</option>
                                <option value="lorebook">Lorebook</option>
                            </select>
                            {#if block.type === 'text'}
                                <select
                                    aria-label="Message role"
                                    class="h-8 w-28 rounded-lg border bg-background px-2 text-xs font-medium"
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
                            {/if}
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
                                onclick={() => onEdit(deleteBlock(workflow, agent.id, block.id))}
                                ><Trash2 class="size-4" /></Button
                            >
                        </div>

                        {#if expandedBlocks.has(block.id)}
                            <div class="flex flex-col gap-4 border-t bg-muted/20 p-4 pl-14">
                                {#if block.type === 'text'}
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
                                {:else if block.type === 'history'}
                                    <div class="grid grid-cols-2 gap-3">
                                        <WorkflowNumberField
                                            label="Start"
                                            value={block.start}
                                            onchange={(value) =>
                                                applyBlockEdit(block.id, { start: value })}
                                        />
                                        <WorkflowNumberField
                                            label="End"
                                            value={block.end}
                                            onchange={(value) =>
                                                applyBlockEdit(block.id, { end: value })}
                                        />
                                    </div>
                                    <p class="-mb-2 text-[11px] font-medium text-muted-foreground">
                                        Message format
                                    </p>
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
                                        class="flex w-fit items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs"
                                        ><input
                                            type="checkbox"
                                            checked={block.reverseOrder ?? false}
                                            onchange={(e) =>
                                                applyBlockEdit(block.id, {
                                                    reverseOrder: e.currentTarget.checked
                                                })}
                                        />Reverse insertion order</label
                                    >
                                    <p class="-mb-2 text-[11px] font-medium text-muted-foreground">
                                        Entry format
                                    </p>
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
                                {/if}
                            </div>
                        {/if}
                    </div>
                {/snippet}

                {#snippet empty()}
                    <div
                        class="mt-1 flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/10 text-center"
                    >
                        <MessageSquareText class="size-8 text-muted-foreground/40" />
                        <div>
                            <p class="text-sm font-medium">No prompt blocks</p>
                            <p class="mt-1 text-xs text-muted-foreground">
                                Add the first block to define this agent's prompt.
                            </p>
                        </div>
                        <Button size="sm" variant="outline" onclick={addBlock}
                            ><Plus class="size-4" /> Add block</Button
                        >
                    </div>
                {/snippet}
            </SortableList>
        </div>
    {:else}
        <div
            class="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground"
        >
            <MessageSquareText class="size-8 opacity-40" />
            This workflow has no Agent node.
        </div>
    {/if}
</div>
