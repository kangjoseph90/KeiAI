<script lang="ts">
    import { Check, ChevronDown } from 'lucide-svelte';
    import { Combobox } from 'bits-ui';

    interface Props {
        id: string;
        value: string;
        suggestions: readonly string[];
        placeholder?: string;
        disabled?: boolean;
        onCommit: (value: string) => void;
    }

    let { id, value, suggestions, placeholder, disabled = false, onCommit }: Props = $props();

    let open = $state(false);
    let inputValue = $state('');
    let selectedValue = $state('');
    let externalValue = $state<string>();
    let committedValue = $state<string>();
    let anchor = $state<HTMLDivElement>();

    const items = $derived(
        suggestions.map((suggestion) => ({
            value: suggestion,
            label: suggestion
        }))
    );
    $effect(() => {
        if (value === externalValue) return;
        externalValue = value;
        committedValue = value;
        inputValue = value;
        selectedValue = suggestions.includes(value) ? value : '';
    });

    function commit(nextValue: string): void {
        if (nextValue === committedValue) return;
        committedValue = nextValue;
        onCommit(nextValue);
    }

    function selectSuggestion(nextValue: string): void {
        selectedValue = nextValue;
        inputValue = nextValue;
        open = false;
        commit(nextValue);
    }

    function handleInput(event: Event): void {
        inputValue = (event.currentTarget as HTMLInputElement).value;
        open = true;
    }
</script>

<Combobox.Root
    type="single"
    {items}
    {disabled}
    allowDeselect={false}
    {inputValue}
    bind:open
    value={selectedValue}
    onValueChange={selectSuggestion}
>
    <div class="relative" bind:this={anchor}>
        <Combobox.Input
            {id}
            defaultValue={value}
            {placeholder}
            autocomplete="off"
            class="border-input bg-muted/40 hover:bg-muted/60 selection:bg-primary dark:bg-input/30 selection:text-primary-foreground ring-offset-background placeholder:text-muted-foreground flex h-9 w-full min-w-0 rounded-md border px-3 py-1 pr-9 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
            onpointerdown={() => (open = true)}
            oninput={handleInput}
            onchange={(event) => commit(event.currentTarget.value)}
        />
        <ChevronDown
            aria-hidden="true"
            class="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
        />
    </div>

    {#if suggestions.length > 0}
        <Combobox.Portal>
            <Combobox.Content
                side="bottom"
                align="start"
                sideOffset={4}
                onInteractOutside={(event) => {
                    if (event.target instanceof Node && anchor?.contains(event.target)) {
                        event.preventDefault();
                    }
                }}
                class="bg-popover text-popover-foreground z-50 w-(--bits-floating-anchor-width) overflow-hidden rounded-md border shadow-md"
            >
                <Combobox.Viewport
                    class="overflow-y-auto overscroll-contain p-1"
                    style="max-height: min(20rem, var(--bits-combobox-content-available-height)); scrollbar-width: thin; scrollbar-color: var(--muted-foreground) transparent;"
                >
                    {#each suggestions as suggestion (suggestion)}
                        <Combobox.Item
                            value={suggestion}
                            label={suggestion}
                            class="data-highlighted:bg-accent data-highlighted:text-accent-foreground relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none"
                        >
                            <span class="truncate">{suggestion}</span>
                            {#if selectedValue === suggestion}
                                <Check class="absolute right-2 size-4" />
                            {/if}
                        </Combobox.Item>
                    {/each}
                </Combobox.Viewport>
            </Combobox.Content>
        </Combobox.Portal>
    {/if}
</Combobox.Root>
