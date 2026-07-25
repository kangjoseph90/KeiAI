<script lang="ts">
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';

    interface Props {
        label: string;
        value: string | undefined;
        placeholder?: string;
        inputmode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'url';
        onchange: (value: string | undefined) => void;
    }

    let { label, value, placeholder, inputmode = 'text', onchange }: Props = $props();
</script>

<div class="flex flex-col gap-1.5">
    <Label class="text-xs">{label}</Label>
    <Input
        type="text"
        {inputmode}
        class="h-8 font-mono text-sm"
        {placeholder}
        value={value ?? ''}
        oninput={(event) => onchange(event.currentTarget.value || undefined)}
    />
</div>
