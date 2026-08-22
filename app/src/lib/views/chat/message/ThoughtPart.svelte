<script lang="ts">
    import { onDestroy } from 'svelte';

    let {
        text,
        collapsible = true
    }: {
        text: string;
        collapsible?: boolean;
    } = $props();

    let isExpanded = $state(false);
    let isAnimating = $state(false);
    let measuredFullHeight = $state(0);
    let timer: ReturnType<typeof setTimeout> | null = null;

    let hasMore = $derived(text.includes('\n') || text.length > 100);
    let canToggle = $derived(collapsible && hasMore);

    function toggle() {
        if (timer) clearTimeout(timer);
        isAnimating = true;
        isExpanded = !isExpanded;
        timer = setTimeout(() => {
            isAnimating = false;
        }, 160);
    }

    onDestroy(() => {
        if (timer) clearTimeout(timer);
    });
</script>

{#if canToggle}
    <button
        type="button"
        class="thought-toggle-btn {isExpanded ? 'is-open' : ''} {isAnimating ? 'is-animating' : ''}"
        style:--full-height={measuredFullHeight > 0 ? `${measuredFullHeight}px` : '100rem'}
        aria-expanded={isExpanded}
        onclick={toggle}
    >
        <div class="thought-ghost" bind:clientHeight={measuredFullHeight} aria-hidden="true">
            {text}
        </div>

        <div class="thought-text">
            {text}
        </div>
    </button>
{:else}
    <div class="thought-text-static">
        {text}
    </div>
{/if}

<style>
    .thought-toggle-btn {
        position: relative;
        display: block;
        width: 100%;
        max-width: 65ch;
        text-align: left;
        font-style: italic;
        line-height: 1.625;
        font-size: 0.75rem;
        color: var(--muted-foreground);
        opacity: 0.8;
        cursor: pointer;
        background: none;
        border: none;
        padding: 0;
        transition: opacity 0.2s ease;
    }

    .thought-toggle-btn:hover {
        opacity: 1;
    }

    .thought-ghost {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        visibility: hidden;
        pointer-events: none;
        white-space: pre-wrap;
        line-height: 1.625;
        font-size: 0.75rem;
        font-style: italic;
        z-index: -1;
    }

    .thought-text {
        white-space: pre-wrap;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        overflow: hidden;
        max-height: 1.25rem;
        transition: max-height var(--motion-duration, 150ms) cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* Apply line-clamp ONLY when fully closed and not animating */
    .thought-toggle-btn:not(.is-open):not(.is-animating) .thought-text {
        line-clamp: 1;
        -webkit-line-clamp: 1;
    }

    .thought-toggle-btn.is-open .thought-text,
    .thought-toggle-btn.is-animating .thought-text {
        line-clamp: unset;
        -webkit-line-clamp: unset;
    }

    .thought-toggle-btn.is-open .thought-text {
        max-height: var(--full-height, 100rem);
    }

    .thought-text-static {
        max-width: 65ch;
        white-space: pre-wrap;
        font-style: italic;
        line-height: 1.625;
        font-size: 0.75rem;
        color: var(--muted-foreground);
        opacity: 0.8;
    }
</style>
