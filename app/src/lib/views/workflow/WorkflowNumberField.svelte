<script lang="ts">
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';

    interface Props {
        label: string;
        value: number | undefined;
        step?: string;
        onchange: (value: number | undefined) => void;
    }

    let { label, value, step = '1', onchange }: Props = $props();
</script>

<div class="flex flex-col gap-1.5">
    <Label class="text-xs">{label}</Label>
    <Input
        type="number"
        {step}
        class="h-8 text-sm"
        value={value ?? ''}
        oninput={(event) =>
            onchange(
                event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value)
            )}
    />
</div>
