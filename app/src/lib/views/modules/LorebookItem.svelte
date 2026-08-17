<script lang="ts">
    import { slide } from 'svelte/transition';
    import type { Lorebook } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { Button } from '$lib/components/ui/button';
    import OptionSelect from '$lib/components/OptionSelect.svelte';
    import EditableListItem from '$lib/components/entitylist/EditableListItem.svelte';
    import { Input } from '$lib/components/ui/input';
    import SyntaxTextarea from '$lib/components/SyntaxTextarea.svelte';
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
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';
    import { t } from '$lib/stores';

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
    let busy = $state(false);

    type ActivationMode = 'keyword' | 'disabled' | 'always';

    const activationModeLabels = $derived({
        keyword: $t('module.lorebookItem.activationKeyword'),
        disabled: $t('module.lorebookItem.activationDisabled'),
        always: $t('module.lorebookItem.activationAlways')
    } satisfies Record<ActivationMode, string>);

    function getActivationMode(): ActivationMode {
        if (item.disabled) return 'disabled';
        if (item.alwaysActive) return 'always';
        return 'keyword';
    }

    function getNextActivationMode(mode: ActivationMode): ActivationMode {
        if (mode === 'keyword') return 'disabled';
        if (mode === 'disabled') return 'always';
        return 'keyword';
    }

    function getActivationChanges(mode: ActivationMode): DeepPartial<Lorebook> {
        if (mode === 'disabled') return { disabled: true, alwaysActive: false };
        if (mode === 'always') return { disabled: false, alwaysActive: true };
        return { disabled: false, alwaysActive: false };
    }

    function getActivationButtonLabel(): string {
        const current = getActivationMode();
        const next = getNextActivationMode(current);
        return `Activation: ${activationModeLabels[current]}. Click to switch to ${activationModeLabels[next]}.`;
    }

    async function handleActivationChange(mode: ActivationMode): Promise<void> {
        await handleUpdate(getActivationChanges(mode));
    }

    $effect(() => {
        if (initiallyEditing && !openedInitially) {
            openedInitially = true;
            expanded = true;
        }
    });

    async function handleUpdate(changes: DeepPartial<Lorebook>): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            await onUpdate(item.id, changes);
        } catch (error) {
            toast.error({
                title: $t('module.lorebookItem.toast.update'),
                description: getErrorMessage(error)
            });
        } finally {
            busy = false;
        }
    }

    async function handleDelete(): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            const confirmed = await appConfirm({
                title: $t('module.lorebookItem.deleteTitle'),
                description: $t('module.lorebookItem.deleteBody', { name: item.name }),
                confirmText: $t('common.confirm.delete'),
                variant: 'destructive'
            });
            if (!confirmed) return;
            await onDelete(item.id);
        } catch (error) {
            toast.error({
                title: $t('module.lorebookItem.toast.delete'),
                description: getErrorMessage(error)
            });
        } finally {
            busy = false;
        }
    }
</script>

<EditableListItem {expanded} {busy} muted={item.disabled}>
    {#snippet header()}
        <div
            class="flex h-7 w-4 shrink-0 cursor-grab active:cursor-grabbing select-none items-center justify-center text-muted-foreground/45 transition-colors hover:text-muted-foreground"
            aria-hidden="true"
        >
            <GripVertical class="size-3.5" />
        </div>
        <button
            type="button"
            class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onclick={() => (expanded = !expanded)}
            aria-label={expanded
                ? $t('module.lorebookItem.collapseAria')
                : $t('module.lorebookItem.expandAria')}
        >
            {#if expanded}
                <ChevronDown class="size-3.5" />
            {:else}
                <ChevronRight class="size-3.5" />
            {/if}
        </button>

        <Input
            disabled={busy}
            value={item.name}
            aria-label={$t('module.lorebookItem.nameAria')}
            class="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 font-medium shadow-none focus-visible:ring-0 dark:bg-transparent text-sm leading-relaxed"
            onchange={(e) => handleUpdate({ name: e.currentTarget.value })}
        />

        <Button
            size="icon-sm"
            variant="ghost"
            class="shrink-0 {getActivationMode() === 'always'
                ? 'text-amber-500 hover:text-amber-600'
                : getActivationMode() === 'disabled'
                  ? 'text-muted-foreground/60 hover:text-muted-foreground'
                  : 'text-muted-foreground hover:text-foreground'}"
            title={getActivationButtonLabel()}
            aria-label={getActivationButtonLabel()}
            disabled={busy}
            onclick={() => handleActivationChange(getNextActivationMode(getActivationMode()))}
        >
            {#if getActivationMode() === 'keyword'}
                <Eye class="size-3.5" />
            {:else if getActivationMode() === 'disabled'}
                <EyeOff class="size-3.5" />
            {:else}
                <Zap class="size-3.5 fill-amber-500/10" />
            {/if}
        </Button>

        <Button
            size="icon-sm"
            variant="ghost"
            class="shrink-0 text-muted-foreground hover:text-destructive"
            title={$t('module.lorebookItem.deleteAria')}
            aria-label={$t('module.lorebookItem.deleteAria')}
            disabled={busy}
            onclick={handleDelete}
        >
            <Trash2 class="size-3.5" />
        </Button>
    {/snippet}

    {#snippet details()}
        <div class="space-y-1.5">
            <Label class="text-xs" for={`activation-mode-${item.id}`}
                >{$t('module.lorebookItem.activationLabel')}</Label
            >
            <OptionSelect
                id={`activation-mode-${item.id}`}
                disabled={busy}
                class="flex h-8 w-full max-w-xs rounded-md border border-input bg-background px-3 py-1 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={getActivationMode()}
                ariaLabel={$t('module.lorebookItem.activationModeAria')}
                options={[
                    { value: 'keyword', label: $t('module.lorebookItem.activationKeyword') },
                    { value: 'disabled', label: $t('module.lorebookItem.activationDisabled') },
                    { value: 'always', label: $t('module.lorebookItem.activationAlways') }
                ]}
                onChange={(value) => handleActivationChange(value as ActivationMode)}
            />
        </div>

        {#if getActivationMode() !== 'always'}
            <div class="grid gap-3 sm:grid-cols-2">
                <div class="space-y-1.5">
                    <Label class="text-xs">{$t('module.lorebookItem.keyLabel')}</Label>
                    <Input
                        disabled={busy}
                        class="h-8 font-mono text-sm"
                        value={item.key}
                        placeholder={$t('module.lorebookItem.keyPlaceholder')}
                        onchange={(e) => handleUpdate({ key: e.currentTarget.value })}
                    />
                </div>
                {#if item.useMultipleKeys && !item.useRegex}
                    <div class="space-y-1.5">
                        <Label class="text-xs">{$t('module.lorebookItem.secondKeyLabel')}</Label>
                        <Input
                            disabled={busy}
                            class="h-8 font-mono text-sm"
                            value={item.secondKey}
                            placeholder={$t('module.lorebookItem.secondKeyPlaceholder')}
                            onchange={(e) => handleUpdate({ secondKey: e.currentTarget.value })}
                        />
                    </div>
                {/if}
            </div>
        {/if}

        <div class="space-y-1.5">
            <Label for={`lorebook-${item.id}-content`} class="text-xs"
                >{$t('module.lorebookItem.contentLabel')}</Label
            >
            <SyntaxTextarea
                id={`lorebook-${item.id}-content`}
                ariaLabel={$t('module.lorebookItem.contentLabel')}
                minRows={5}
                language="markdown"
                template
                disabled={busy}
                class="text-sm min-h-25 font-sans bg-background"
                value={item.content}
                placeholder={$t('module.lorebookItem.contentPlaceholder')}
                onchange={(e) => handleUpdate({ content: e.currentTarget.value })}
            />
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
                <Label class="text-xs">{$t('module.lorebookItem.depthLabel')}</Label>
                <Input
                    disabled={busy}
                    class="h-8 text-sm"
                    type="number"
                    value={item.depth}
                    onchange={(e) => handleUpdate({ depth: parseInt(e.currentTarget.value) || 0 })}
                />
            </div>
            <div class="space-y-1.5">
                <Label class="text-xs">{$t('module.lorebookItem.orderLabel')}</Label>
                <Input
                    disabled={busy}
                    class="h-8 text-sm"
                    type="number"
                    value={item.order}
                    onchange={(e) => handleUpdate({ order: parseInt(e.currentTarget.value) || 0 })}
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
                {$t('module.lorebookItem.advancedToggle')}
                {#if advancedOpen}
                    <ChevronUp class="size-3" />
                {:else}
                    <ChevronDown class="size-3" />
                {/if}
            </Button>

            {#if advancedOpen}
                <div transition:slide={{ duration: 150 }}>
                    <div class="grid gap-4 p-4 rounded-lg bg-muted/30 border">
                        <div class="grid gap-3 sm:grid-cols-2">
                            <div class="space-y-1.5">
                                <Label class="text-xs"
                                    >{$t('module.lorebookItem.insertionRoleLabel')}</Label
                                >
                                <OptionSelect
                                    disabled={busy}
                                    class="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    value={item.role}
                                    options={[
                                        {
                                            value: 'system',
                                            label: $t('module.lorebookItem.roleSystem')
                                        },
                                        {
                                            value: 'user',
                                            label: $t('module.lorebookItem.roleUser')
                                        },
                                        {
                                            value: 'assistant',
                                            label: $t('module.lorebookItem.roleAssistant')
                                        }
                                    ]}
                                    onChange={(value) =>
                                        handleUpdate({
                                            role: value as LLMRole
                                        })}
                                />
                            </div>
                            <div class="space-y-1.5">
                                <Label class="text-xs"
                                    >{$t('module.lorebookItem.probabilityLabel')}</Label
                                >
                                <Input
                                    disabled={busy}
                                    class="h-8 text-sm"
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={item.probability}
                                    onchange={(e) =>
                                        handleUpdate({
                                            probability: parseInt(e.currentTarget.value) || 0
                                        })}
                                />
                            </div>
                        </div>

                        <div class="space-y-3">
                            <div class="flex items-center gap-2 select-none">
                                <input
                                    type="checkbox"
                                    class="size-4 rounded border-input text-primary focus:ring-primary cursor-pointer"
                                    checked={item.scanDepth !== undefined}
                                    disabled={busy}
                                    id="scanDepthToggle"
                                    onchange={(e) =>
                                        handleUpdate({
                                            scanDepth: e.currentTarget.checked ? 5 : undefined
                                        })}
                                />
                                <Label
                                    for="scanDepthToggle"
                                    class="text-xs font-medium cursor-pointer"
                                    >{$t('module.lorebookItem.scanDepthLabel')}</Label
                                >
                                {#if item.scanDepth !== undefined}
                                    <Input
                                        disabled={busy}
                                        class="h-7 w-20 ml-2 text-xs"
                                        type="number"
                                        value={item.scanDepth}
                                        onchange={(e) =>
                                            handleUpdate({
                                                scanDepth: parseInt(e.currentTarget.value) || 5
                                            })}
                                    />
                                {/if}
                            </div>

                            <div
                                class="grid grid-cols-1 gap-x-2 gap-y-3 select-none sm:grid-cols-2"
                            >
                                <label class="flex items-center gap-2 cursor-pointer text-xs">
                                    <input
                                        type="checkbox"
                                        class="size-4 rounded border-input text-primary focus:ring-primary"
                                        checked={item.useRegex}
                                        disabled={busy}
                                        onchange={(e) => {
                                            const checked = e.currentTarget.checked;
                                            handleUpdate({
                                                useRegex: checked,
                                                useMultipleKeys: checked
                                                    ? false
                                                    : item.useMultipleKeys
                                            });
                                        }}
                                    />
                                    <span>{$t('module.lorebookItem.regexLabel')}</span>
                                </label>
                                <label class="flex items-center gap-2 cursor-pointer text-xs">
                                    <input
                                        type="checkbox"
                                        class="size-4 rounded border-input text-primary focus:ring-primary"
                                        checked={item.useMultipleKeys}
                                        disabled={busy || item.useRegex}
                                        onchange={(e) =>
                                            handleUpdate({
                                                useMultipleKeys: e.currentTarget.checked
                                            })}
                                    />
                                    <span>{$t('module.lorebookItem.requireSecondKey')}</span>
                                </label>
                                <label class="flex items-center gap-2 cursor-pointer text-xs">
                                    <input
                                        type="checkbox"
                                        class="size-4 rounded border-input text-primary focus:ring-primary"
                                        checked={item.recursive}
                                        disabled={busy}
                                        onchange={(e) =>
                                            handleUpdate({
                                                recursive: e.currentTarget.checked
                                            })}
                                    />
                                    <span>{$t('module.lorebookItem.recursive')}</span>
                                </label>
                                <label class="flex items-center gap-2 cursor-pointer text-xs">
                                    <input
                                        type="checkbox"
                                        class="size-4 rounded border-input text-primary focus:ring-primary"
                                        checked={item.noRecursiveSearch}
                                        disabled={busy}
                                        onchange={(e) =>
                                            handleUpdate({
                                                noRecursiveSearch: e.currentTarget.checked
                                            })}
                                    />
                                    <span>{$t('module.lorebookItem.noRecursiveSearch')}</span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            {/if}
        </div>
    {/snippet}
</EditableListItem>
