<script lang="ts">
    import {
        Bot,
        BookOpen,
        Brain,
        Check,
        ChevronDown,
        ChevronRight,
        ChevronUp,
        Copy,
        Download,
        Eye,
        EyeOff,
        GripVertical,
        MessageSquareText,
        MessagesSquare,
        MoreHorizontal,
        Plus,
        SlidersHorizontal,
        Trash2,
        Upload,
        X
    } from 'lucide-svelte';
    import { slide } from '$lib/stores';
    import { SvelteSet } from 'svelte/reactivity';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import SyntaxTextarea from '$lib/components/SyntaxTextarea.svelte';
    import OptionSelect from '$lib/components/OptionSelect.svelte';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
    import SortableList from '$lib/components/entitylist/SortableList.svelte';
    import EditableListItem from '$lib/components/entitylist/EditableListItem.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import WorkflowNumberField from './WorkflowNumberField.svelte';
    import WorkflowStringField from './WorkflowStringField.svelte';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { generateSortOrder } from '$lib/utils/ordering';
    import type { LLMRole, LLMType } from '$lib/types/models/llm';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';
    import { exportAgentFile, importAgentFile } from '$lib/managers';
    import { t } from '$lib/stores';
    import {
        createAgentInput,
        createBlock,
        deleteAgentInput,
        deleteBlock,
        deleteNode,
        renameAgentInput,
        replaceAgentConfiguration,
        updateBlock,
        updateNode,
        type AgentNode,
        type PromptBlock,
        type WorkflowDefinition,
        type WorkflowEditResult,
        type WorkflowNodeChanges
    } from '$lib/workflow';
    import { listAgentTools } from '$lib/workflow/agent/tool';

    interface Props {
        workflow: WorkflowDefinition;
        selectedNodeId: string | null;
        onSelectNode: (nodeId: string) => void;
        onEdit: (result: WorkflowEditResult) => void | Promise<void>;
    }

    let { workflow, selectedNodeId, onSelectNode, onEdit }: Props = $props();
    let expandedBlocks = $state<Set<string>>(new Set());
    let agentSettingsExpanded = $state(false);
    let deletingBlockId = $state<string | null>(null);
    let copiedSlotId = $state<string | null>(null);
    let transferringAgent = $state(false);

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
    const agentTools = listAgentTools();
    const inputEntries = $derived(Object.entries(agent?.slotNames ?? {}));

    function updateAgentSettings(changes: WorkflowNodeChanges) {
        if (!agent) return;
        return onEdit(updateNode(workflow, agent.id, changes));
    }

    function updateAgentNumber(
        field: 'maxContext' | 'maxResponse' | 'lorebookRatio' | 'memoryRatio' | 'lorebookScanDepth',
        value: string
    ) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            updateAgentSettings({ [field]: parsed } as WorkflowNodeChanges);
        }
    }

    function updateAgentTool(toolId: string, enabled: boolean) {
        if (!agent) return;
        const current = agent.toolIds;
        const toolIds = enabled
            ? current.includes(toolId)
                ? current
                : [...current, toolId]
            : current.filter((id) => id !== toolId);
        updateAgentSettings({ toolIds });
    }

    function addInputSlot() {
        if (!agent) return;
        let index = Object.keys(agent.slotNames).length + 1;
        let name = `input${index}`;
        while (Object.values(agent.slotNames).includes(name)) name = `input${++index}`;
        return onEdit(createAgentInput(workflow, agent.id, name));
    }

    function renameInputSlot(inputId: string, name: string) {
        if (!agent) return;
        return onEdit(renameAgentInput(workflow, agent.id, inputId, name));
    }

    function deleteInputSlot(inputId: string) {
        if (!agent) return;
        return onEdit(deleteAgentInput(workflow, agent.id, inputId));
    }

    function copyInputSlotMacro(slotId: string, slotName: string) {
        void navigator.clipboard.writeText(`{{slot::${slotName}}}`);
        copiedSlotId = slotId;
        setTimeout(() => {
            if (copiedSlotId === slotId) copiedSlotId = null;
        }, 1500);
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
                name: $t('workflow.agent.newBlock'),
                type: 'message',
                role: 'system',
                content: '',
                sortOrder
            })
        );
    }

    function changeBlockType(blockId: string, type: PromptBlock['type']) {
        switch (type) {
            case 'message':
                return applyBlockEdit(blockId, { type, role: 'system', content: '' });
            case 'history':
                return applyBlockEdit(blockId, { type, historyMode: 'visible' });
            case 'lorebook':
                return applyBlockEdit(blockId, { type });
            case 'memory':
                return applyBlockEdit(blockId, {
                    type,
                    algorithmId: 'mock',
                    importance: 1,
                    role: 'system'
                });
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
                title: $t('workflow.agent.deleteBlockTitle'),
                description: $t('workflow.agent.deleteBlockBody', { name: block.name }),
                confirmText: $t('common.actions.delete'),
                variant: 'destructive'
            });
            if (!confirmed || agent?.id !== agentId) return;
            await onEdit(deleteBlock(workflow, agentId, block.id));
        } finally {
            deletingBlockId = null;
        }
    }

    async function importAgent() {
        if (!agent || transferringAgent) return;
        const agentId = agent.id;
        transferringAgent = true;
        try {
            const configuration = await importAgentFile();
            if (!configuration || agent?.id !== agentId) return;
            const confirmed = await appConfirm({
                title: $t('workflow.agent.replaceTitle'),
                description: $t('workflow.agent.replaceBody'),
                confirmText: $t('common.actions.import')
            });
            if (!confirmed || agent?.id !== agentId) return;
            await onEdit(replaceAgentConfiguration(workflow, agentId, configuration));
        } catch (error) {
            toast.error({
                title: $t('workflow.agent.toast.importFailed'),
                description: getErrorMessage(
                    error,
                    $t('workflow.agent.toast.importFailedDescription')
                )
            });
        } finally {
            transferringAgent = false;
        }
    }

    async function exportAgent() {
        if (!agent || transferringAgent) return;
        transferringAgent = true;
        try {
            const saved = await exportAgentFile(agent);
            if (saved) toast.success({ title: $t('workflow.agent.toast.exported') });
        } catch (error) {
            toast.error({
                title: $t('workflow.agent.toast.exportFailed'),
                description: getErrorMessage(
                    error,
                    $t('workflow.agent.toast.exportFailedDescription')
                )
            });
        } finally {
            transferringAgent = false;
        }
    }
</script>

<div class="min-h-full w-full bg-muted/15 p-4 sm:p-6">
    <div class="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-4">
        {#if agent}
            <!-- 1. Agent Header Card -->
            <div class="flex flex-col gap-3 rounded-xl border bg-background p-4 shadow-xs">
                <div class="flex items-center justify-between gap-3">
                    <div class="flex min-w-0 items-center gap-2.5">
                        <div class="flex items-center gap-2">
                            <div
                                class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400"
                            >
                                <Bot class="size-4" />
                            </div>
                            <OptionSelect
                                id="workflow-agent"
                                ariaLabel={$t('workflow.agent.agentAria')}
                                class="h-8 min-w-0 rounded-md border bg-background px-2.5 text-xs text-foreground shadow-2xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                                value={agent.id}
                                options={agents.map((item) => ({
                                    value: item.id,
                                    label: item.name
                                }))}
                                onChange={onSelectNode}
                            />
                        </div>

                        <div
                            class="flex h-8 items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 text-xs"
                            title={$t('workflow.agent.llmType')}
                        >
                            <span class="text-[10px] uppercase text-muted-foreground/70"
                                >{$t('workflow.agent.llm')}</span
                            >
                            <span class="max-w-28 truncate text-foreground">{agent.llmType}</span>
                        </div>
                    </div>

                    <div class="flex shrink-0 items-center gap-1">
                        <DropdownMenu.Root>
                            <DropdownMenu.Trigger>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    class="size-8"
                                    title={$t('workflow.agent.fileActions')}
                                    aria-label={$t('workflow.agent.fileActions')}
                                    disabled={transferringAgent}
                                >
                                    <MoreHorizontal class="size-4" />
                                </Button>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Content align="end">
                                <DropdownMenu.Item onclick={importAgent}>
                                    <Upload class="size-4" />
                                    {$t('workflow.agent.importInto')}
                                </DropdownMenu.Item>
                                <DropdownMenu.Item onclick={exportAgent}>
                                    <Download class="size-4" />
                                    {$t('workflow.agent.exportThis')}
                                </DropdownMenu.Item>
                            </DropdownMenu.Content>
                        </DropdownMenu.Root>

                        <Button
                            variant={agentSettingsExpanded ? 'secondary' : 'ghost'}
                            size="icon-sm"
                            class="size-8"
                            onclick={() => (agentSettingsExpanded = !agentSettingsExpanded)}
                            title={agentSettingsExpanded
                                ? $t('workflow.agent.collapseConfig')
                                : $t('workflow.agent.expandConfig')}
                            aria-label={$t('workflow.agent.toggleSettings')}
                        >
                            <SlidersHorizontal class="size-4" />
                        </Button>
                    </div>
                </div>

                {#if agentSettingsExpanded}
                    <div
                        transition:slide={{ duration: 150 }}
                        class="flex flex-col gap-4 border-t border-border/60 pt-3.5"
                    >
                        <div class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                            <label class="flex flex-col gap-1 text-muted-foreground">
                                {$t('workflow.agent.llmType')}
                                <input
                                    class="h-7 rounded-md border bg-background px-2 text-xs text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                                    value={agent.llmType}
                                    onchange={(e) =>
                                        updateAgentSettings({
                                            llmType: e.currentTarget.value as LLMType
                                        })}
                                />
                            </label>
                            <label class="flex flex-col gap-1 text-muted-foreground">
                                {$t('workflow.agent.maxContext')}
                                <input
                                    type="number"
                                    class="h-7 rounded-md border bg-background px-2 text-xs text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                                    value={agent.maxContext}
                                    onchange={(e) =>
                                        updateAgentNumber('maxContext', e.currentTarget.value)}
                                />
                            </label>
                            <label class="flex flex-col gap-1 text-muted-foreground">
                                {$t('workflow.agent.maxResponse')}
                                <input
                                    type="number"
                                    class="h-7 rounded-md border bg-background px-2 text-xs text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                                    value={agent.maxResponse}
                                    onchange={(e) =>
                                        updateAgentNumber('maxResponse', e.currentTarget.value)}
                                />
                            </label>
                            <label class="flex flex-col gap-1 text-muted-foreground">
                                {$t('workflow.agent.lorebookRatio')}
                                <input
                                    type="number"
                                    step="0.05"
                                    class="h-7 rounded-md border bg-background px-2 text-xs text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                                    value={agent.lorebookRatio}
                                    onchange={(e) =>
                                        updateAgentNumber('lorebookRatio', e.currentTarget.value)}
                                />
                            </label>
                            <label class="flex flex-col gap-1 text-muted-foreground">
                                {$t('workflow.agent.memoryRatio')}
                                <input
                                    type="number"
                                    step="0.05"
                                    class="h-7 rounded-md border bg-background px-2 text-xs text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                                    value={agent.memoryRatio}
                                    onchange={(e) =>
                                        updateAgentNumber('memoryRatio', e.currentTarget.value)}
                                />
                            </label>
                            <label class="flex flex-col gap-1 text-muted-foreground">
                                {$t('workflow.agent.scanDepth')}
                                <input
                                    type="number"
                                    class="h-7 rounded-md border bg-background px-2 text-xs text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                                    value={agent.lorebookScanDepth}
                                    onchange={(e) =>
                                        updateAgentNumber(
                                            'lorebookScanDepth',
                                            e.currentTarget.value
                                        )}
                                />
                            </label>
                        </div>

                        <!-- Tools Section -->
                        <div class="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
                            <span class="text-xs font-normal text-muted-foreground"
                                >{$t('workflow.agent.tools')}</span
                            >
                            <div class="flex flex-wrap gap-x-5 gap-y-2">
                                {#each agentTools as tool (tool.id)}
                                    <label
                                        class="flex cursor-pointer select-none items-center gap-2 text-xs text-foreground"
                                    >
                                        <input
                                            type="checkbox"
                                            class="size-4 accent-primary"
                                            checked={agent.toolIds.includes(tool.id)}
                                            onchange={(e) =>
                                                updateAgentTool(tool.id, e.currentTarget.checked)}
                                        />
                                        {tool.label}
                                    </label>
                                {/each}
                            </div>
                        </div>
                    </div>
                {/if}
            </div>

            <!-- 2. Input Slots Section (Unwrapped, clean inline section) -->
            <div class="flex flex-col gap-2.5 px-1 py-1">
                <div class="flex items-center justify-between">
                    <span class="text-sm font-semibold text-foreground/90"
                        >{$t('workflow.agent.inputSlots')}</span
                    >
                    <Button
                        size="sm"
                        variant="outline"
                        class="h-8 gap-1.5 text-xs font-medium"
                        onclick={addInputSlot}
                    >
                        <Plus class="size-3.5" />
                        {$t('workflow.agent.addInput')}
                    </Button>
                </div>

                {#if inputEntries.length > 0}
                    <div class="flex flex-wrap gap-2">
                        {#each Object.entries(agent.slotNames) as [inputId, slotName] (inputId)}
                            {@const copied = copiedSlotId === inputId}
                            <div
                                class="flex items-center gap-1 rounded-lg border bg-background px-2 py-1 shadow-2xs transition-colors hover:border-primary/40"
                            >
                                <input
                                    class="h-6 min-w-16 w-auto flex-1 rounded border-0 bg-transparent px-1 text-xs text-foreground outline-hidden focus:bg-muted/30"
                                    value={slotName}
                                    onchange={(e) =>
                                        renameInputSlot(inputId, e.currentTarget.value)}
                                />
                                <button
                                    type="button"
                                    class="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                    onclick={() => copyInputSlotMacro(inputId, slotName)}
                                    title={$t('workflow.agent.copyMacro', {
                                        macro: `{{slot::${slotName}}}`
                                    })}
                                >
                                    {#if copied}
                                        <Check class="size-3 text-emerald-500" />
                                    {:else}
                                        <Copy class="size-3" />
                                    {/if}
                                </button>
                                <button
                                    type="button"
                                    class="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                                    onclick={() => deleteInputSlot(inputId)}
                                    title={$t('workflow.agent.deleteSlot')}
                                >
                                    <X class="size-3" />
                                </button>
                            </div>
                        {/each}
                    </div>
                {:else}
                    <EmptyListPlaceholder message={$t('workflow.agent.noSlots')} />
                {/if}
            </div>

            <!-- 3. Prompt Section -->
            <section class="flex min-h-0 flex-1 flex-col gap-3 pt-1">
                <div class="flex items-center justify-between px-1">
                    <span class="text-sm font-semibold text-foreground/90"
                        >{$t('workflow.agent.prompt')}</span
                    >
                    <Button size="sm" class="h-8 gap-1.5 text-xs font-medium" onclick={addBlock}>
                        <Plus class="size-3.5" />
                        {$t('workflow.agent.addBlock')}
                    </Button>
                </div>

                <div class="min-h-0 flex-1">
                    <SortableList
                        entities={Object.values(blocks)}
                        onReorder={(id, sortOrder) => applyBlockEdit(id, { sortOrder })}
                    >
                        {#snippet item({ entity: block })}
                            <EditableListItem
                                muted={!block.enabled}
                                expanded={expandedBlocks.has(block.id)}
                                busy={deletingBlockId === block.id}
                            >
                                {#snippet header()}
                                    <div
                                        class="flex h-7 w-4 shrink-0 cursor-grab active:cursor-grabbing select-none items-center justify-center text-muted-foreground/45 transition-colors hover:text-muted-foreground"
                                        aria-hidden="true"
                                    >
                                        <GripVertical class="size-3.5" />
                                    </div>
                                    <button
                                        type="button"
                                        class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                                        onclick={() => toggleBlock(block.id)}
                                        aria-label={expandedBlocks.has(block.id)
                                            ? $t('workflow.agent.collapseBlock')
                                            : $t('workflow.agent.expandBlock')}
                                    >
                                        {#if expandedBlocks.has(block.id)}
                                            <ChevronDown class="size-3.5" />
                                        {:else}
                                            <ChevronRight class="size-3.5" />
                                        {/if}
                                    </button>

                                    <DropdownMenu.Root>
                                        <DropdownMenu.Trigger
                                            class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-700 dark:text-violet-300"
                                            title={$t('workflow.agent.changeBlockType')}
                                        >
                                            {#if block.type === 'message'}
                                                <MessageSquareText class="size-3.5" />
                                            {:else if block.type === 'history'}
                                                <MessagesSquare class="size-3.5" />
                                            {:else if block.type === 'lorebook'}
                                                <BookOpen class="size-3.5" />
                                            {:else if block.type === 'memory'}
                                                <Brain class="size-3.5" />
                                            {/if}
                                        </DropdownMenu.Trigger>
                                        <DropdownMenu.Content align="start">
                                            <DropdownMenu.Item
                                                onclick={() => changeBlockType(block.id, 'message')}
                                            >
                                                <MessageSquareText
                                                    class="mr-2 size-4 text-violet-500"
                                                />
                                                <span>{$t('workflow.agent.blockMessage')}</span>
                                            </DropdownMenu.Item>
                                            <DropdownMenu.Item
                                                onclick={() => changeBlockType(block.id, 'history')}
                                            >
                                                <MessagesSquare class="mr-2 size-4 text-sky-500" />
                                                <span>{$t('workflow.agent.blockHistory')}</span>
                                            </DropdownMenu.Item>
                                            <DropdownMenu.Item
                                                onclick={() =>
                                                    changeBlockType(block.id, 'lorebook')}
                                            >
                                                <BookOpen class="mr-2 size-4 text-amber-500" />
                                                <span>{$t('workflow.agent.blockLorebook')}</span>
                                            </DropdownMenu.Item>
                                            <DropdownMenu.Item
                                                onclick={() => changeBlockType(block.id, 'memory')}
                                            >
                                                <Brain class="mr-2 size-4 text-emerald-500" />
                                                <span>{$t('workflow.agent.blockMemory')}</span>
                                            </DropdownMenu.Item>
                                        </DropdownMenu.Content>
                                    </DropdownMenu.Root>

                                    <Input
                                        value={block.name}
                                        aria-label={$t('workflow.agent.blockName')}
                                        class="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
                                        oninput={(e) =>
                                            applyBlockEdit(block.id, {
                                                name: e.currentTarget.value
                                            })}
                                    />

                                    <div class="flex items-center gap-1">
                                        <button
                                            type="button"
                                            class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                                            onclick={() =>
                                                applyBlockEdit(block.id, {
                                                    enabled: !block.enabled
                                                })}
                                            title={block.enabled
                                                ? $t('workflow.agent.disableBlock')
                                                : $t('workflow.agent.enableBlock')}
                                            aria-label={block.enabled
                                                ? $t('workflow.agent.disableBlock')
                                                : $t('workflow.agent.enableBlock')}
                                        >
                                            {#if block.enabled}
                                                <Eye class="size-3.5" />
                                            {:else}
                                                <EyeOff class="size-3.5" />
                                            {/if}
                                        </button>
                                        <button
                                            type="button"
                                            class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
                                            onclick={() => removeBlock(block)}
                                            title={$t('workflow.agent.deleteBlock')}
                                            aria-label={$t('workflow.agent.deleteBlock')}
                                        >
                                            <Trash2 class="size-3.5" />
                                        </button>
                                    </div>
                                {/snippet}

                                {#snippet details()}
                                    <div class="flex flex-col gap-3">
                                        {#if block.type === 'message'}
                                            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                                <div class="flex flex-col gap-1.5">
                                                    <Label class="text-xs"
                                                        >{$t('workflow.agent.role')}</Label
                                                    >
                                                    <OptionSelect
                                                        id={`workflow-block-${block.id}-role`}
                                                        class="h-9 w-full rounded-md border bg-background px-3 text-xs shadow-2xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                                                        value={block.role ?? 'system'}
                                                        options={[
                                                            {
                                                                value: 'system',
                                                                label: $t(
                                                                    'workflow.agent.roleSystem'
                                                                )
                                                            },
                                                            {
                                                                value: 'user',
                                                                label: $t('workflow.agent.roleUser')
                                                            },
                                                            {
                                                                value: 'assistant',
                                                                label: $t(
                                                                    'workflow.agent.roleAssistant'
                                                                )
                                                            }
                                                        ]}
                                                        onChange={(value) =>
                                                            applyBlockEdit(block.id, {
                                                                role: value as LLMRole
                                                            })}
                                                    />
                                                </div>
                                            </div>

                                            <div class="flex flex-col gap-1.5">
                                                <Label
                                                    for={`workflow-block-${block.id}-content`}
                                                    class="text-xs"
                                                    >{$t('workflow.agent.content')}</Label
                                                >
                                                <SyntaxTextarea
                                                    id={`workflow-block-${block.id}-content`}
                                                    ariaLabel={$t('workflow.agent.content')}
                                                    language="markdown"
                                                    template
                                                    value={block.content ?? ''}
                                                    placeholder={$t(
                                                        'workflow.agent.contentPlaceholder'
                                                    )}
                                                    minRows={6}
                                                    class="resize-y bg-background font-mono text-xs leading-relaxed"
                                                    oninput={(e) =>
                                                        applyBlockEdit(block.id, {
                                                            content: e.currentTarget.value
                                                        })}
                                                />
                                            </div>
                                        {:else if block.type === 'history'}
                                            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                                <WorkflowStringField
                                                    label={$t('workflow.agent.start')}
                                                    value={block.start}
                                                    onchange={(value) =>
                                                        applyBlockEdit(block.id, { start: value })}
                                                />
                                                <WorkflowStringField
                                                    label={$t('workflow.agent.end')}
                                                    value={block.end}
                                                    onchange={(value) =>
                                                        applyBlockEdit(block.id, { end: value })}
                                                />
                                            </div>
                                            <div class="flex flex-col gap-1.5">
                                                <Label class="text-xs"
                                                    >{$t('workflow.agent.historyMode')}</Label
                                                >
                                                <OptionSelect
                                                    id={`workflow-block-${block.id}-history-mode`}
                                                    class="h-9 w-full rounded-md border bg-background px-3 text-xs shadow-2xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                                                    value={block.historyMode ?? 'visible'}
                                                    options={[
                                                        {
                                                            value: 'visible',
                                                            label: $t(
                                                                'workflow.agent.historyVisibleParts'
                                                            )
                                                        },
                                                        {
                                                            value: 'last_text',
                                                            label: $t(
                                                                'workflow.agent.historyLastText'
                                                            )
                                                        },
                                                        {
                                                            value: 'full_trace',
                                                            label: $t(
                                                                'workflow.agent.historyFullTrace'
                                                            )
                                                        }
                                                    ]}
                                                    onChange={(value) =>
                                                        applyBlockEdit(block.id, {
                                                            historyMode: value as
                                                                | 'visible'
                                                                | 'last_text'
                                                                | 'full_trace'
                                                        })}
                                                />
                                            </div>
                                            <div class="flex flex-col gap-1.5">
                                                <Label
                                                    for={`workflow-block-${block.id}-format`}
                                                    class="text-xs flex items-center justify-between"
                                                >
                                                    <span>{$t('workflow.agent.messageFormat')}</span
                                                    >
                                                    <span
                                                        class="text-[10px] text-muted-foreground font-normal"
                                                        >{$t('common.state.optional')}</span
                                                    >
                                                </Label>
                                                <SyntaxTextarea
                                                    id={`workflow-block-${block.id}-format`}
                                                    ariaLabel={$t('workflow.agent.messageFormat')}
                                                    language="markdown"
                                                    template
                                                    value={block.format ?? ''}
                                                    placeholder={$t(
                                                        'workflow.agent.formatPlaceholder'
                                                    )}
                                                    minRows={5}
                                                    class="resize-y bg-background font-mono text-xs leading-relaxed"
                                                    oninput={(e) =>
                                                        applyBlockEdit(block.id, {
                                                            format:
                                                                e.currentTarget.value || undefined
                                                        })}
                                                />
                                            </div>
                                        {:else if block.type === 'memory'}
                                            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                                <WorkflowStringField
                                                    label={$t('workflow.agent.start')}
                                                    value={block.start}
                                                    onchange={(value) =>
                                                        applyBlockEdit(block.id, { start: value })}
                                                />
                                                <WorkflowStringField
                                                    label={$t('workflow.agent.end')}
                                                    value={block.end}
                                                    onchange={(value) =>
                                                        applyBlockEdit(block.id, { end: value })}
                                                />
                                            </div>
                                            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                                <div class="flex flex-col gap-1.5">
                                                    <Label class="text-xs"
                                                        >{$t(
                                                            'workflow.agent.memoryAlgorithm'
                                                        )}</Label
                                                    >
                                                    <OptionSelect
                                                        id={`workflow-block-${block.id}-memory-algorithm`}
                                                        class="h-9 w-full rounded-md border bg-background px-3 text-xs shadow-2xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                                                        value={block.algorithmId}
                                                        options={[
                                                            {
                                                                value: 'mock',
                                                                label: $t(
                                                                    'workflow.agent.memoryAlgorithmMock'
                                                                )
                                                            }
                                                        ]}
                                                        onChange={(value) =>
                                                            applyBlockEdit(block.id, {
                                                                algorithmId: value
                                                            })}
                                                    />
                                                </div>
                                                <WorkflowNumberField
                                                    label={$t('workflow.agent.importance')}
                                                    value={block.importance}
                                                    onchange={(value) =>
                                                        applyBlockEdit(block.id, {
                                                            importance: value ?? 1
                                                        })}
                                                />
                                            </div>
                                            <div class="flex flex-col gap-1.5">
                                                <Label class="text-xs"
                                                    >{$t('workflow.agent.role')}</Label
                                                >
                                                <OptionSelect
                                                    id={`workflow-block-${block.id}-role`}
                                                    class="h-9 w-full rounded-md border bg-background px-3 text-xs shadow-2xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                                                    value={block.role}
                                                    options={[
                                                        {
                                                            value: 'system',
                                                            label: $t('workflow.agent.roleSystem')
                                                        },
                                                        {
                                                            value: 'user',
                                                            label: $t('workflow.agent.roleUser')
                                                        },
                                                        {
                                                            value: 'assistant',
                                                            label: $t(
                                                                'workflow.agent.roleAssistant'
                                                            )
                                                        }
                                                    ]}
                                                    onChange={(value) =>
                                                        applyBlockEdit(block.id, {
                                                            role: value as LLMRole
                                                        })}
                                                />
                                            </div>
                                            <div class="flex flex-col gap-1.5">
                                                <Label
                                                    for={`workflow-block-${block.id}-format`}
                                                    class="text-xs flex items-center justify-between"
                                                >
                                                    <span>{$t('workflow.agent.messageFormat')}</span
                                                    >
                                                    <span
                                                        class="text-[10px] text-muted-foreground font-normal"
                                                        >{$t('common.state.optional')}</span
                                                    >
                                                </Label>
                                                <SyntaxTextarea
                                                    id={`workflow-block-${block.id}-format`}
                                                    ariaLabel={$t('workflow.agent.messageFormat')}
                                                    language="markdown"
                                                    template
                                                    value={block.format ?? ''}
                                                    placeholder={$t(
                                                        'workflow.agent.formatPlaceholder'
                                                    )}
                                                    minRows={5}
                                                    class="resize-y bg-background font-mono text-xs leading-relaxed"
                                                    oninput={(e) =>
                                                        applyBlockEdit(block.id, {
                                                            format:
                                                                e.currentTarget.value || undefined
                                                        })}
                                                />
                                            </div>
                                        {:else if block.type === 'lorebook'}
                                            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                                <WorkflowNumberField
                                                    label={$t('workflow.agent.minDepth')}
                                                    value={block.minDepth}
                                                    onchange={(value) =>
                                                        applyBlockEdit(block.id, {
                                                            minDepth: value
                                                        })}
                                                />
                                                <WorkflowNumberField
                                                    label={$t('workflow.agent.maxDepth')}
                                                    value={block.maxDepth}
                                                    onchange={(value) =>
                                                        applyBlockEdit(block.id, {
                                                            maxDepth: value
                                                        })}
                                                />
                                            </div>
                                            <label
                                                class="flex w-fit items-center gap-2 text-xs select-none cursor-pointer"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={block.reverseOrder ?? false}
                                                    onchange={(e) =>
                                                        applyBlockEdit(block.id, {
                                                            reverseOrder: e.currentTarget.checked
                                                        })}
                                                />{$t('workflow.agent.reverseInsertion')}</label
                                            >
                                            <div class="flex flex-col gap-1.5">
                                                <Label
                                                    for={`workflow-block-${block.id}-entry-format`}
                                                    class="text-xs flex items-center justify-between"
                                                >
                                                    <span>{$t('workflow.agent.entryFormat')}</span>
                                                    <span
                                                        class="text-[10px] text-muted-foreground font-normal"
                                                        >{$t('common.state.optional')}</span
                                                    >
                                                </Label>
                                                <SyntaxTextarea
                                                    id={`workflow-block-${block.id}-entry-format`}
                                                    ariaLabel={$t('workflow.agent.entryFormat')}
                                                    language="markdown"
                                                    template
                                                    value={block.format ?? ''}
                                                    placeholder={$t(
                                                        'workflow.agent.formatPlaceholder'
                                                    )}
                                                    minRows={5}
                                                    class="resize-y bg-background font-mono text-xs leading-relaxed"
                                                    oninput={(e) =>
                                                        applyBlockEdit(block.id, {
                                                            format:
                                                                e.currentTarget.value || undefined
                                                        })}
                                                />
                                            </div>
                                        {/if}
                                    </div>
                                {/snippet}
                            </EditableListItem>
                        {/snippet}

                        {#snippet empty()}
                            <EmptyListPlaceholder message={$t('workflow.agent.emptyBlocks')} />
                        {/snippet}
                    </SortableList>
                </div>
            </section>
        {:else}
            <EmptyListPlaceholder message={$t('workflow.agent.empty')} />
        {/if}
    </div>
</div>
