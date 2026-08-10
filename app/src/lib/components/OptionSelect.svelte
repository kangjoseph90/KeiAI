<script lang="ts">
    import { Check, ChevronDown } from 'lucide-svelte';
    import { Select } from 'bits-ui';
    import { cn } from '$lib/utils';

    interface Option {
        value: string;
        label: string;
    }

    interface Props {
        id?: string;
        value: string;
        options: readonly Option[];
        disabled?: boolean;
        class?: string;
        ariaLabel?: string;
        ariaBusy?: boolean;
        onChange: (value: string) => void;
    }

    let {
        id,
        value,
        options,
        disabled = false,
        class: className,
        ariaLabel,
        ariaBusy,
        onChange
    }: Props = $props();

    const items = $derived(options.map((option) => ({ ...option })));
    const selectedOption = $derived(options.find((option) => option.value === value) ?? options[0]);
    const selectedValue = $derived(selectedOption?.value ?? '');
    const selectedLabel = $derived(selectedOption?.label ?? '');
</script>

<Select.Root
    type="single"
    value={selectedValue}
    {items}
    {disabled}
    allowDeselect={false}
    onValueChange={onChange}
>
    <Select.Trigger
        {id}
        aria-label={ariaLabel}
        aria-busy={ariaBusy}
        class={cn(
            'border-input bg-muted/40 hover:bg-muted/60 dark:bg-input/30 ring-offset-background focus-visible:border-ring focus-visible:ring-ring/50 relative flex h-9 w-full items-center rounded-md border px-3 py-1 pr-9 text-left text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
            className
        )}
    >
        <span class="truncate">{selectedLabel}</span>
        <ChevronDown
            aria-hidden="true"
            class="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
        />
    </Select.Trigger>

    <Select.Portal>
        <Select.Content
            side="bottom"
            align="start"
            sideOffset={4}
            class="bg-popover text-popover-foreground z-50 w-(--bits-select-anchor-width) overflow-hidden rounded-md border shadow-md"
        >
            <Select.Viewport
                class="overflow-y-auto overscroll-contain p-1"
                style="max-height: min(20rem, var(--bits-select-content-available-height)); scrollbar-width: thin; scrollbar-color: var(--muted-foreground) transparent;"
            >
                {#each options as option (option.value)}
                    <Select.Item
                        value={option.value}
                        label={option.label}
                        class="data-highlighted:bg-accent data-highlighted:text-accent-foreground relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none"
                    >
                        <span class="truncate">{option.label}</span>
                        {#if selectedValue === option.value}
                            <Check class="absolute right-2 size-4" />
                        {/if}
                    </Select.Item>
                {/each}
            </Select.Viewport>
        </Select.Content>
    </Select.Portal>
</Select.Root>
