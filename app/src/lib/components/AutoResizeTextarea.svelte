<script lang="ts">
    /**
     * AutoResizeTextarea — Auto-resizing textarea for chat input.
     * Grows with content up to maxHeight, then scrolls.
     */
    import { onMount } from 'svelte';

    let {
        value = $bindable(''),
        placeholder = '',
        disabled = false,
        maxHeight = 200,
        minRows = 1,
        classname = '',
        onkeydown = (_e: KeyboardEvent) => {}
    }: {
        value?: string;
        placeholder?: string;
        disabled?: boolean;
        maxHeight?: number;
        minRows?: number;
        classname?: string;
        onkeydown?: (e: KeyboardEvent) => void;
    } = $props();

    let textareaEl: HTMLTextAreaElement | undefined = $state();

    function resize() {
        if (!textareaEl) return;
        textareaEl.style.height = 'auto';
        const newHeight = Math.min(textareaEl.scrollHeight, maxHeight);
        textareaEl.style.height = `${newHeight}px`;
    }

    $effect(() => {
        // Resize whenever value changes
        void value;
        // Use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(resize);
    });

    onMount(() => {
        resize();
    });
</script>

<textarea
    bind:this={textareaEl}
    bind:value
    {placeholder}
    {disabled}
    rows={minRows}
    oninput={resize}
    {onkeydown}
    class="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 {classname}"
    style="max-height: {maxHeight}px; overflow-y: auto;"
></textarea>
