<script lang="ts">
    import type { Snippet } from 'svelte';
    import { Label } from '$lib/components/ui/label';

    interface Props {
        label: string;
        children: Snippet;
    }

    let { label, children }: Props = $props();
</script>

<div class="flex flex-col gap-1.5">
    <Label>{label}</Label>
    {@render children()}
</div>
