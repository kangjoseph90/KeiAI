<script lang="ts">
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';

    interface Props {
        label: string;
        value: string | undefined;
        onchange: (value: string | undefined) => void;
    }

    let { label, value, onchange }: Props = $props();
</script>

<div class="flex flex-col gap-1.5">
    <Label class="text-xs">{label}</Label>
    <Input
        type="text"
        class="h-8 text-sm"
        value={value ?? ''}
        oninput={(event) =>
            onchange(
                event.currentTarget.value === '' ? undefined : event.currentTarget.value
            )}
    />
</div>
