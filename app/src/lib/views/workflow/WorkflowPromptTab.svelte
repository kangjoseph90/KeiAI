<script lang="ts">
    import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-svelte';
    import { SvelteSet } from 'svelte/reactivity';
    import { Button } from '$lib/components/ui/button';
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Textarea } from '$lib/components/ui/textarea';
    import SortableList from '$lib/components/entitylist/SortableList.svelte';
    import WorkflowField from './WorkflowField.svelte';
    import WorkflowNumberField from './WorkflowNumberField.svelte';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { generateSortOrder } from '$lib/utils/ordering';
    import type { LLMRole, LLMType } from '$lib/types/models/llm';
    import {
        createAgentInput,
        createBlock,
        deleteAgentInput,
        deleteBlock,
        renameAgentInput,
        updateBlock,
        updateNode,
        type AgentNode,
        type PromptBlock,
        type WorkflowDefinition,
        type WorkflowEditResult,
        type WorkflowNodeChanges
    } from '$lib/workflow';

    interface Props {
        workflow: WorkflowDefinition;
        selectedNodeId: string | null;
        onSelectNode: (nodeId: string) => void;
        onEdit: (result: WorkflowEditResult) => void | Promise<void>;
    }

    let { workflow, selectedNodeId, onSelectNode, onEdit }: Props = $props();
    let expandedBlocks = $state<Set<string>>(new Set());

    const agents = $derived(
        Object.values(workflow.nodes).filter((node): node is AgentNode => node.class === 'Agent')
    );
    const agent = $derived(
        selectedNodeId && workflow.nodes[selectedNodeId]?.class === 'Agent'
            ? (workflow.nodes[selectedNodeId] as AgentNode)
            : null
    );
    const blocks = $derived(agent?.promptBlocks ?? {});

    function applyAgentEdit(changes: WorkflowNodeChanges) {
        if (!agent) return;
        return onEdit(updateNode(workflow, agent.id, changes));
    }

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

    function addSlot() {
        if (!agent) return;
        let index = Object.keys(agent.slotNames).length + 1;
        let name = `input${index}`;
        while (Object.values(agent.slotNames).includes(name)) name = `input${++index}`;
        return onEdit(createAgentInput(workflow, agent.id, name));
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

<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto pr-1">
    <div class="flex items-center gap-3">
        <Label for="workflow-agent" class="shrink-0">Agent</Label>
        <select
            id="workflow-agent"
            class="h-9 min-w-56 rounded-md border bg-background px-3 text-sm"
            value={agent?.id ?? ''}
            onchange={(event) => onSelectNode(event.currentTarget.value)}
        >
            {#each agents as item (item.id)}
                <option value={item.id}>{item.name}</option>
            {/each}
        </select>
    </div>

    {#if agent}
        <Card>
            <CardHeader><CardTitle class="text-base">Agent Settings</CardTitle></CardHeader>
            <CardContent class="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <WorkflowField label="Name">
                    <Input
                        value={agent.name}
                        oninput={(e) => applyAgentEdit({ name: e.currentTarget.value })}
                    />
                </WorkflowField>
                <WorkflowField label="LLM Type">
                    <Input
                        value={agent.llmType}
                        oninput={(e) =>
                            applyAgentEdit({ llmType: e.currentTarget.value as LLMType })}
                    />
                </WorkflowField>
                <WorkflowNumberField
                    label="Max Context"
                    value={agent.maxContext}
                    onchange={(value) =>
                        value !== undefined && applyAgentEdit({ maxContext: value })}
                />
                <WorkflowNumberField
                    label="Max Response"
                    value={agent.maxResponse}
                    onchange={(value) =>
                        value !== undefined && applyAgentEdit({ maxResponse: value })}
                />
                <WorkflowNumberField
                    label="Lorebook Ratio"
                    value={agent.lorebookRatio}
                    step="0.05"
                    onchange={(value) =>
                        value !== undefined && applyAgentEdit({ lorebookRatio: value })}
                />
                <WorkflowNumberField
                    label="Memory Ratio"
                    value={agent.memoryRatio}
                    step="0.05"
                    onchange={(value) =>
                        value !== undefined && applyAgentEdit({ memoryRatio: value })}
                />
                <WorkflowNumberField
                    label="Lorebook Scan Depth"
                    value={agent.lorebookScanDepth}
                    onchange={(value) =>
                        value !== undefined && applyAgentEdit({ lorebookScanDepth: value })}
                />
            </CardContent>
        </Card>

        <Card>
            <CardHeader class="flex-row items-center justify-between">
                <CardTitle class="text-base">Input Slots</CardTitle>
                <Button size="sm" variant="outline" onclick={addSlot}
                    ><Plus class="size-4" /> Add</Button
                >
            </CardHeader>
            <CardContent class="flex flex-col gap-2">
                {#each Object.keys(agent.inputs) as inputId (inputId)}
                    <div class="flex items-center gap-2 rounded-md border p-2">
                        <Input
                            value={agent.slotNames[inputId] ?? ''}
                            class="h-8"
                            onchange={(e) =>
                                onEdit(
                                    renameAgentInput(
                                        workflow,
                                        agent.id,
                                        inputId,
                                        e.currentTarget.value
                                    )
                                )}
                        />
                        <span class="min-w-28 text-xs text-muted-foreground">
                            {agent.inputs[inputId] ? 'Connected' : 'Not connected'}
                        </span>
                        <Button
                            size="icon"
                            variant="ghost"
                            class="size-8 text-destructive"
                            onclick={() => onEdit(deleteAgentInput(workflow, agent.id, inputId))}
                            ><Trash2 class="size-4" /></Button
                        >
                    </div>
                {:else}
                    <p class="text-sm text-muted-foreground">No input slots.</p>
                {/each}
            </CardContent>
        </Card>

        <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold">Prompt Blocks</h3>
            <Button size="sm" variant="outline" onclick={addBlock}
                ><Plus class="size-4" /> Add Block</Button
            >
        </div>

        <SortableList
            entities={Object.values(blocks)}
            onReorder={(id, sortOrder) => applyBlockEdit(id, { sortOrder })}
        >
            {#snippet item({ entity: block })}
                <Card class={!block.enabled ? 'opacity-60' : ''}>
                    <CardContent class="flex flex-col gap-3 p-4">
                        <div class="flex items-center gap-2">
                            <button
                                class="shrink-0 rounded p-1 hover:bg-muted"
                                onclick={() => toggleBlock(block.id)}
                                aria-label={expandedBlocks.has(block.id)
                                    ? 'Collapse block'
                                    : 'Expand block'}
                            >
                                {#if expandedBlocks.has(block.id)}
                                    <ChevronDown class="size-4 text-muted-foreground" />
                                {:else}
                                    <ChevronRight class="size-4 text-muted-foreground" />
                                {/if}
                            </button>
                            <Input
                                value={block.name}
                                class="h-8 flex-1 font-medium"
                                oninput={(e) =>
                                    applyBlockEdit(block.id, { name: e.currentTarget.value })}
                            />
                            <select
                                class="h-8 rounded-md border bg-background px-2 text-sm"
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
                                    class="h-8 w-28 rounded-md border bg-background px-2 text-sm"
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
                            <label class="flex items-center gap-1 text-xs">
                                <input
                                    type="checkbox"
                                    checked={block.enabled}
                                    onchange={(e) =>
                                        applyBlockEdit(block.id, {
                                            enabled: e.currentTarget.checked
                                        })}
                                />
                                Enabled
                            </label>
                            <Button
                                size="icon"
                                variant="ghost"
                                class="size-8 text-destructive"
                                onclick={() => onEdit(deleteBlock(workflow, agent.id, block.id))}
                                ><Trash2 class="size-4" /></Button
                            >
                        </div>

                        {#if expandedBlocks.has(block.id)}
                            <div class="flex flex-col gap-3 pl-6">
                                {#if block.type === 'text'}
                                    <Textarea
                                        value={block.content}
                                        rows={5}
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
                                    <Textarea
                                        value={block.format ?? ''}
                                        placeholder="Custom format"
                                        rows={4}
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
                                    <label class="flex items-center gap-2 text-xs"
                                        ><input
                                            type="checkbox"
                                            checked={block.reverseOrder ?? false}
                                            onchange={(e) =>
                                                applyBlockEdit(block.id, {
                                                    reverseOrder: e.currentTarget.checked
                                                })}
                                        />Reverse order</label
                                    >
                                    <Textarea
                                        value={block.format ?? ''}
                                        placeholder="Custom format"
                                        rows={4}
                                        oninput={(e) =>
                                            applyBlockEdit(block.id, {
                                                format: e.currentTarget.value || undefined
                                            })}
                                    />
                                {/if}
                            </div>
                        {/if}
                    </CardContent>
                </Card>
            {/snippet}
        </SortableList>
    {:else}
        <div class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            This workflow has no Agent node.
        </div>
    {/if}
</div>
