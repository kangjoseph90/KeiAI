<script lang="ts">
    import { untrack } from 'svelte';

    interface Props {
        text: string;
        speed?: number;
        class?: string;
    }

    let { text, speed = 30, class: className = '' }: Props = $props();

    let displayText = $state(untrack(() => text));
    let isTyping = $state(false);
    let previousText = $state(untrack(() => text));

    $effect(() => {
        const currentText = text;
        const prev = untrack(() => previousText);
        previousText = currentText;

        if (currentText === prev) {
            displayText = currentText;
            return;
        }

        let timer: ReturnType<typeof setInterval> | null = null;

        const charDelay = Math.min(
            speed,
            Math.max(12, Math.floor(600 / Math.max(currentText.length, 1)))
        );

        let commonLength = 0;
        while (
            commonLength < prev.length &&
            commonLength < currentText.length &&
            prev[commonLength] === currentText[commonLength]
        ) {
            commonLength++;
        }

        let index = commonLength;
        displayText = currentText.slice(0, index);
        isTyping = true;

        timer = setInterval(() => {
            if (index < currentText.length) {
                index++;
                displayText = currentText.slice(0, index);
            } else {
                if (timer) clearInterval(timer);
                isTyping = false;
                displayText = currentText;
            }
        }, charDelay);

        return () => {
            if (timer) clearInterval(timer);
            isTyping = false;
        };
    });
</script>

<span class={className}>
    {displayText}{#if isTyping}<span
            class="ml-0.5 inline-block h-[1em] w-0.5 animate-pulse bg-primary align-middle opacity-80"
            aria-hidden="true"
        ></span>{/if}
</span>
