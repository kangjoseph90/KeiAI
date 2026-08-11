<script lang="ts">
    import {
        AlignLeft,
        GripVertical,
        List,
        MessageSquareText,
        Minus,
        Plus,
        SquareCheck,
        Trash2,
        Type
    } from 'lucide-svelte';
    import { SvelteSet } from 'svelte/reactivity';
    import { Button } from '$lib/components/ui/button';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import EditableListItem from '$lib/components/entitylist/EditableListItem.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import ListActionBar from '$lib/components/ListActionBar.svelte';
    import type { FolderDef } from '$lib/types/refs';
    import type {
        ToggleControlItem,
        ToggleItem,
        TogglePanel,
        ToggleSelectOption
    } from '$lib/types/toggle';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';
    import { generateId } from '$lib/utils/id';
    import { generateSortOrder, listItems } from '$lib/utils/ordering';
    import { t } from '$lib/stores';

    type ToggleItemType = 'checkbox' | 'select' | 'text' | 'textarea' | 'caption' | 'divider';

    interface Props {
        panel: TogglePanel;
        onSaveItem: (item: ToggleItem) => Promise<void>;
        onDeleteItem: (itemId: string) => Promise<void>;
        onCreateFolder: (name: string, parentId?: string, sortOrder?: string) => Promise<FolderDef>;
        onUpdateFolder: (folderId: string, changes: Partial<FolderDef>) => Promise<void>;
        onDeleteFolder: (folderId: string) => Promise<void>;
        onMoveItem: (itemId: string, folderId?: string, sortOrder?: string) => Promise<void>;
    }

    let {
        panel,
        onSaveItem,
        onDeleteItem,
        onCreateFolder,
        onUpdateFolder,
        onDeleteFolder,
        onMoveItem
    }: Props = $props();
    let busy = $state(false);
    const expandedSelects = new SvelteSet<string>();

    async function addToggle(): Promise<void> {
        const id = generateId();
        await run(() =>
            onSaveItem({
                id,
                kind: 'control',
                key: 'toggle',
                label: $t('components.toggles.newToggle'),
                sortOrder: generateSortOrder(panel.refs, panel.folders),
                control: { type: 'checkbox', value: false }
            })
        );
    }

    async function save(item: ToggleItem): Promise<void> {
        await run(() => onSaveItem(item));
    }

    async function remove(item: ToggleItem): Promise<void> {
        const confirmed = await appConfirm({
            title: $t('components.toggles.deleteTitle'),
            description: $t('components.toggles.deleteBody'),
            confirmText: $t('common.actions.delete'),
            variant: 'destructive'
        });
        if (confirmed) await run(() => onDeleteItem(item.id));
    }

    function changeType(item: ToggleItem, type: ToggleItemType): void {
        if (itemType(item) === type) return;
        const base = {
            id: item.id,
            folderId: item.folderId,
            sortOrder: item.sortOrder
        };
        const key = item.kind === 'control' ? item.key : 'toggle';
        const label =
            item.kind === 'control'
                ? item.label
                : item.kind === 'text'
                  ? item.text
                  : (item.label ?? '');
        let updated: ToggleItem;
        switch (type) {
            case 'checkbox':
                updated = {
                    ...base,
                    kind: 'control',
                    key,
                    label,
                    control: { type: 'checkbox', value: false }
                };
                break;
            case 'select': {
                const optionId = generateId();
                updated = {
                    ...base,
                    kind: 'control',
                    key,
                    label,
                    control: {
                        type: 'select',
                        options: [{ id: optionId, label: $t('components.toggles.optionDefault') }],
                        selectedOptionId: optionId
                    }
                };
                break;
            }
            case 'text':
            case 'textarea':
                updated = {
                    ...base,
                    kind: 'control',
                    key,
                    label,
                    control: {
                        type: 'text',
                        multiline: type === 'textarea',
                        value:
                            item.kind === 'control' && item.control.type === 'text'
                                ? item.control.value
                                : ''
                    }
                };
                break;
            case 'caption':
                updated = { ...base, kind: 'text', text: label };
                break;
            case 'divider':
                updated = { ...base, kind: 'divider', label };
                break;
        }
        void save(updated);
    }

    function itemType(item: ToggleItem): ToggleItemType {
        if (item.kind === 'text') return 'caption';
        if (item.kind === 'divider') return 'divider';
        if (item.control.type === 'text') return item.control.multiline ? 'textarea' : 'text';
        return item.control.type;
    }

    function typeIconClass(type: ToggleItemType): string {
        switch (type) {
            case 'checkbox':
                return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300';
            case 'select':
                return 'bg-sky-500/10 text-sky-600 dark:text-sky-300';
            case 'text':
                return 'bg-violet-500/10 text-violet-600 dark:text-violet-300';
            case 'textarea':
                return 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300';
            case 'caption':
                return 'bg-amber-500/10 text-amber-600 dark:text-amber-300';
            case 'divider':
                return 'bg-muted text-muted-foreground';
        }
    }

    function toggleSelectEditor(itemId: string): void {
        if (expandedSelects.has(itemId)) expandedSelects.delete(itemId);
        else expandedSelects.add(itemId);
    }

    function saveSelectOptions(item: ToggleControlItem, next: ToggleSelectOption[]): void {
        if (item.control.type !== 'select') return;
        const control = item.control;
        void save({
            ...item,
            control: {
                ...control,
                options: next,
                selectedOptionId: next.some((option) => option.id === control.selectedOptionId)
                    ? control.selectedOptionId
                    : (next[0]?.id ?? '')
            }
        });
    }

    function addSelectOption(item: ToggleControlItem): void {
        if (item.control.type !== 'select') return;
        saveSelectOptions(item, [
            ...item.control.options,
            { id: generateId(), label: $t('components.toggles.newOption') }
        ]);
    }

    function updateSelectOption(item: ToggleControlItem, optionId: string, label: string): void {
        if (item.control.type !== 'select') return;
        saveSelectOptions(
            item,
            item.control.options.map((option) =>
                option.id === optionId ? { ...option, label } : option
            )
        );
    }

    function removeSelectOption(item: ToggleControlItem, optionId: string): void {
        if (item.control.type !== 'select') return;
        saveSelectOptions(
            item,
            item.control.options.filter((option) => option.id !== optionId)
        );
    }

    async function run(action: () => Promise<unknown>): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            await action();
        } catch (error) {
            toast.error({
                title: $t('components.toggles.updateFailed'),
                description: getErrorMessage(error)
            });
        } finally {
            busy = false;
        }
    }
</script>

<div class="flex flex-col gap-4 px-2">
    <ListActionBar description={$t('components.toggles.description')}>
        <Button size="sm" class="gap-1.5" disabled={busy} onclick={addToggle}>
            <Plus class="size-4" />
            {$t('components.toggles.add')}
        </Button>
    </ListActionBar>

    <EntityList
        entities={listItems(panel)}
        config={panel}
        mode="manage"
        layout="list"
        {onCreateFolder}
        {onUpdateFolder}
        {onDeleteFolder}
        {onMoveItem}
    >
        {#snippet empty()}
            <EmptyListPlaceholder message={$t('components.toggles.empty')} />
        {/snippet}
        {#snippet item({ entity }: { entity: ToggleItem })}
            <EditableListItem
                expanded={entity.kind === 'control' &&
                    entity.control.type === 'select' &&
                    expandedSelects.has(entity.id)}
                {busy}
            >
                {#snippet header()}
                    <div
                        class="flex h-7 w-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground/45 transition-colors hover:text-muted-foreground active:cursor-grabbing select-none"
                        aria-hidden="true"
                    >
                        <GripVertical class="size-3.5" />
                    </div>

                    <DropdownMenu.Root>
                        <DropdownMenu.Trigger>
                            <button
                                type="button"
                                class="flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 {typeIconClass(
                                    itemType(entity)
                                )}"
                                aria-label={$t('components.toggles.changeType')}
                                disabled={busy}
                            >
                                {#if itemType(entity) === 'checkbox'}
                                    <SquareCheck class="size-3.5" />
                                {:else if itemType(entity) === 'select'}
                                    <List class="size-3.5" />
                                {:else if itemType(entity) === 'text'}
                                    <Type class="size-3.5" />
                                {:else if itemType(entity) === 'textarea'}
                                    <AlignLeft class="size-3.5" />
                                {:else if itemType(entity) === 'caption'}
                                    <MessageSquareText class="size-3.5" />
                                {:else}
                                    <Minus class="size-3.5" />
                                {/if}
                            </button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Content align="start">
                            <DropdownMenu.Item onclick={() => changeType(entity, 'checkbox')}>
                                <SquareCheck class="mr-2 size-4 text-emerald-500" />
                                <span>{$t('components.toggles.checkbox')}</span>
                            </DropdownMenu.Item>
                            <DropdownMenu.Item onclick={() => changeType(entity, 'select')}>
                                <List class="mr-2 size-4 text-sky-500" />
                                <span>{$t('components.toggles.select')}</span>
                            </DropdownMenu.Item>
                            <DropdownMenu.Item onclick={() => changeType(entity, 'text')}>
                                <Type class="mr-2 size-4 text-violet-500" />
                                <span>{$t('components.toggles.text')}</span>
                            </DropdownMenu.Item>
                            <DropdownMenu.Item onclick={() => changeType(entity, 'textarea')}>
                                <AlignLeft class="mr-2 size-4 text-indigo-500" />
                                <span>{$t('components.toggles.textarea')}</span>
                            </DropdownMenu.Item>
                            <DropdownMenu.Item onclick={() => changeType(entity, 'caption')}>
                                <MessageSquareText class="mr-2 size-4 text-amber-500" />
                                <span>{$t('components.toggles.caption')}</span>
                            </DropdownMenu.Item>
                            <DropdownMenu.Item onclick={() => changeType(entity, 'divider')}>
                                <Minus class="mr-2 size-4 text-muted-foreground" />
                                <span>{$t('components.toggles.divider')}</span>
                            </DropdownMenu.Item>
                        </DropdownMenu.Content>
                    </DropdownMenu.Root>

                    {#if entity.kind === 'control'}
                        <input
                            class="h-7 min-w-0 rounded-lg border bg-background px-2 font-mono text-xs shadow-sm sm:w-36"
                            value={entity.key}
                            disabled={busy}
                            onchange={(event) =>
                                save({ ...entity, key: event.currentTarget.value })}
                            placeholder={$t('components.toggles.keyPlaceholder')}
                        />
                        <input
                            class="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm font-medium shadow-none outline-none"
                            value={entity.label}
                            disabled={busy}
                            onchange={(event) =>
                                save({ ...entity, label: event.currentTarget.value })}
                            placeholder={$t('components.toggles.labelPlaceholder')}
                        />
                    {:else}
                        <input
                            class="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm font-medium shadow-none outline-none"
                            value={entity.kind === 'text' ? entity.text : (entity.label ?? '')}
                            disabled={busy}
                            onchange={(event) =>
                                save(
                                    entity.kind === 'text'
                                        ? { ...entity, text: event.currentTarget.value }
                                        : { ...entity, label: event.currentTarget.value }
                                )}
                            placeholder={entity.kind === 'text'
                                ? $t('components.toggles.captionPlaceholder')
                                : $t('components.toggles.dividerPlaceholder')}
                        />
                    {/if}

                    {#if entity.kind === 'control' && entity.control.type === 'select'}
                        <Button
                            variant="outline"
                            size="sm"
                            class="h-7 shrink-0 px-2 text-[11px]"
                            disabled={busy}
                            onclick={() => toggleSelectEditor(entity.id)}
                            aria-expanded={expandedSelects.has(entity.id)}
                        >
                            {$t('components.toggles.optionsCount', {
                                count: entity.control.options.length
                            })}
                        </Button>
                    {/if}
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        class="shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={busy}
                        onclick={() => remove(entity)}
                        aria-label={$t('components.toggles.deleteToggle')}
                    >
                        <Trash2 class="size-3.5" />
                    </Button>
                {/snippet}

                {#snippet details()}
                    {#if entity.kind === 'control' && entity.control.type === 'select'}
                        <div class="flex flex-col gap-2">
                            <p class="text-xs font-medium text-muted-foreground">
                                {$t('components.toggles.options')}
                            </p>
                            {#each entity.control.options as option (option.id)}
                                <div class="flex items-center gap-2">
                                    <input
                                        class="h-8 min-w-0 flex-1 rounded-lg border bg-background px-3 text-xs shadow-sm"
                                        value={option.label}
                                        disabled={busy}
                                        onchange={(event) =>
                                            updateSelectOption(
                                                entity,
                                                option.id,
                                                event.currentTarget.value
                                            )}
                                        aria-label={$t('components.toggles.optionLabelAria')}
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        class="shrink-0 text-muted-foreground hover:text-destructive"
                                        disabled={busy || entity.control.options.length <= 1}
                                        onclick={() => removeSelectOption(entity, option.id)}
                                        aria-label={$t('components.toggles.deleteOption')}
                                    >
                                        <Trash2 class="size-4" />
                                    </Button>
                                </div>
                            {/each}
                            <Button
                                variant="outline"
                                size="sm"
                                class="mt-1 w-fit gap-1.5"
                                disabled={busy}
                                onclick={() => addSelectOption(entity)}
                            >
                                <Plus class="size-4" />
                                {$t('components.toggles.addOption')}
                            </Button>
                        </div>
                    {/if}
                {/snippet}
            </EditableListItem>
        {/snippet}
    </EntityList>
</div>
