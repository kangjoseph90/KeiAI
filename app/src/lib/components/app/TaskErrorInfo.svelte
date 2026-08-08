<script lang="ts">
    import { Info } from 'lucide-svelte';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
    import { Button } from '$lib/components/ui/button';

    let { errorMessage }: { errorMessage?: string } = $props();

    let open = $state(false);
    let closeTimer: ReturnType<typeof setTimeout> | null = null;

    function cancelClose(): void {
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = null;
    }

    function scheduleClose(event: PointerEvent): void {
        if (event.pointerType !== 'mouse') return;
        cancelClose();
        closeTimer = setTimeout(() => (open = false), 120);
    }

    function openFromHover(event: PointerEvent): void {
        if (event.pointerType !== 'mouse') return;
        cancelClose();
        open = true;
    }
</script>

<DropdownMenu.Root bind:open>
    <DropdownMenu.Trigger
        onpointerenter={openFromHover}
        onpointerleave={scheduleClose}
        data-no-reorder-drag
    >
        <Button
            variant="ghost"
            size="icon-sm"
            class="size-6 shrink-0 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
            aria-label="Show error details"
            title="Error details"
        >
            <Info class="size-3.5" />
        </Button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Content
        align="start"
        sideOffset={4}
        class="z-70 w-[min(20rem,calc(100vw-2rem))] p-3"
        onpointerenter={(event) => {
            if (event.pointerType === 'mouse') cancelClose();
        }}
        onpointerleave={scheduleClose}
    >
        <p class="mb-1 text-xs font-medium text-destructive">Error details</p>
        <p class="whitespace-pre-wrap wrap-break-word text-xs text-popover-foreground">
            {errorMessage || 'No additional error information is available.'}
        </p>
    </DropdownMenu.Content>
</DropdownMenu.Root>
