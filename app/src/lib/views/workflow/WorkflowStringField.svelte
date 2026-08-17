<script lang="ts">
    import { Label } from '$lib/components/ui/label';
    import SyntaxTextarea from '$lib/components/SyntaxTextarea.svelte';

    interface Props {
        label: string;
        value: string | undefined;
        placeholder?: string;
        onchange: (value: string | undefined) => void;
    }

    let { label, value, placeholder, onchange }: Props = $props();
</script>

<div class="flex flex-col gap-1.5">
    <Label class="text-xs">{label}</Label>
    <SyntaxTextarea
        compact
        template
        ariaLabel={label}
        class="h-8 font-mono text-sm"
        {placeholder}
        value={value ?? ''}
        onchange={(event) => onchange(event.currentTarget.value || undefined)}
    />
</div>
