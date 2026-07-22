<script lang="ts">
    import { ChevronDown, ChevronRight } from 'lucide-svelte';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import { getToggleValue, setToggleValue } from '$lib/managers/toggle';
    import { getErrorMessage } from '$lib/types/errors';
    import type { ToggleItem, ToggleOwner, TogglePanel } from '$lib/types/toggle';
    import { toast } from '$lib/ui';
    import { listItems } from '$lib/utils/ordering';

    interface Props {
        panel: TogglePanel;
        owner: ToggleOwner;
    }

    let { panel, owner }: Props = $props();
    let busyItemId = $state<string | null>(null);

    async function changeValue(itemId: string, value: unknown): Promise<void> {
        if (busyItemId) return;
        busyItemId = itemId;
        try {
            await setToggleValue(owner, itemId, value);
        } catch (error) {
            toast.error({
                title: 'Could not update toggle',
                description: getErrorMessage(error)
            });
        } finally {
            busyItemId = null;
        }
    }
</script>

<EntityList
    entities={listItems(panel)}
    config={panel}
    mode="browse"
    layout="list"
    listClass="flex w-full flex-col gap-1.5"
    childContainerClass="ml-2 border-l border-sidebar-border px-2 py-1"
    folderWrapperClass={() => 'w-full py-0.5'}
    itemWrapperClass={() => 'w-full py-0.5'}
>
    {#snippet folder({ folder, collapsed, toggle })}
        <button
            type="button"
            class="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-xs font-medium hover:bg-sidebar-accent"
            onclick={toggle}
        >
            {#if collapsed}<ChevronRight class="size-3" />{:else}<ChevronDown class="size-3" />{/if}
            <span class="truncate">{folder.name}</span>
        </button>
    {/snippet}
    {#snippet item({ entity }: { entity: ToggleItem })}
        {#if entity.kind === 'text'}
            <p class="select-text px-1 text-[11px] leading-relaxed text-muted-foreground">
                {entity.text}
            </p>
        {:else if entity.kind === 'divider'}
            <div class="flex items-center gap-2 py-1" aria-hidden="true">
                <div class="h-px flex-1 bg-sidebar-border"></div>
                {#if entity.label}
                    <span class="text-[10px] text-muted-foreground">{entity.label}</span>
                    <div class="h-px flex-1 bg-sidebar-border"></div>
                {/if}
            </div>
        {:else}
            {@const value = getToggleValue(entity)}
            {#if entity.control.type === 'checkbox'}
                <label
                    class="flex cursor-pointer items-center justify-between gap-2 rounded px-1 py-1 text-xs hover:bg-sidebar-accent"
                >
                    <span>{entity.label}</span>
                    <input
                        type="checkbox"
                        checked={value === true}
                        disabled={busyItemId !== null}
                        onchange={(event) => changeValue(entity.id, event.currentTarget.checked)}
                    />
                </label>
            {:else if entity.control.type === 'select'}
                <label
                    class="flex items-center justify-between gap-2 rounded px-1 py-0.5 text-xs hover:bg-sidebar-accent"
                >
                    <span class="min-w-0 flex-1 truncate">{entity.label}</span>
                    <select
                        class="h-7 w-36 max-w-[60%] shrink-0 select-text rounded border bg-background px-2 text-xs"
                        value={String(value)}
                        disabled={busyItemId !== null}
                        onchange={(event) => changeValue(entity.id, event.currentTarget.value)}
                    >
                        {#each entity.control.options as option (option.id)}
                            <option value={option.id}>{option.label}</option>
                        {/each}
                    </select>
                </label>
            {:else if entity.control.multiline}
                <label class="flex flex-col gap-1 px-1 py-1 text-xs">
                    <span>{entity.label}</span>
                    <textarea
                        class="min-h-16 select-text resize-y rounded border bg-background px-2 py-1.5 text-xs"
                        value={String(value)}
                        disabled={busyItemId !== null}
                        onchange={(event) => changeValue(entity.id, event.currentTarget.value)}
                    ></textarea>
                </label>
            {:else}
                <label
                    class="flex items-center justify-between gap-2 rounded px-1 py-0.5 text-xs hover:bg-sidebar-accent"
                >
                    <span class="min-w-0 flex-1 truncate">{entity.label}</span>
                    <input
                        class="h-7 w-36 max-w-[60%] shrink-0 select-text rounded border bg-background px-2 text-xs"
                        value={String(value)}
                        disabled={busyItemId !== null}
                        onchange={(event) => changeValue(entity.id, event.currentTarget.value)}
                    />
                </label>
            {/if}
        {/if}
    {/snippet}
</EntityList>
