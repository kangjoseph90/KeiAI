<script lang="ts">
    import type { CharJS } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Badge } from '$lib/components/ui/badge';
    import { Label } from '$lib/components/ui/label';
    import { ChevronDown, ChevronRight, Eye, EyeOff, Trash2 } from 'lucide-svelte';

    let {
        item,
        initiallyEditing = false,
        onUpdate,
        onDelete
    }: {
        item: CharJS;
        initiallyEditing?: boolean;
        onUpdate: (id: string, changes: DeepPartial<CharJS>) => void | Promise<void>;
        onDelete: (id: string) => void | Promise<void>;
    } = $props();

    let expanded = $state(false);
    let openedInitially = $state(false);

    $effect(() => {
        if (initiallyEditing && !openedInitially) {
            openedInitially = true;
            expanded = true;
        }
    });
</script>

<div
    class="group overflow-hidden rounded-xl border bg-card shadow-sm transition-[border-color,box-shadow,opacity] hover:border-border/80 hover:shadow-md {item.enabled
        ? ''
        : 'opacity-55'}"
>
    <div class="flex min-h-14 items-center gap-2 px-3 py-2">
        <button
            type="button"
            class="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onclick={() => (expanded = !expanded)}
            aria-label={expanded ? 'Collapse script' : 'Expand script'}
        >
            {#if expanded}
                <ChevronDown class="size-4" />
            {:else}
                <ChevronRight class="size-4" />
            {/if}
        </button>

        <Input
            value={item.name}
            aria-label="Script name"
            class="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 font-medium shadow-none focus-visible:ring-0 text-sm leading-relaxed"
            onchange={(e) => onUpdate(item.id, { name: e.currentTarget.value })}
        />

        {#if !item.enabled}
            <Badge variant="outline" class="text-xs shrink-0">Disabled</Badge>
        {/if}

        <Button
            size="icon"
            variant="ghost"
            class="size-8 shrink-0 text-muted-foreground"
            title={item.enabled ? 'Disable script' : 'Enable script'}
            aria-label={item.enabled ? 'Disable script' : 'Enable script'}
            onclick={() => onUpdate(item.id, { enabled: !item.enabled })}
        >
            {#if item.enabled}
                <Eye class="size-4" />
            {:else}
                <EyeOff class="size-4" />
            {/if}
        </Button>
        <Button
            size="icon"
            variant="ghost"
            class="size-8 shrink-0 text-muted-foreground hover:text-destructive"
            title="Delete script"
            aria-label="Delete script"
            onclick={() => onDelete(item.id)}
        >
            <Trash2 class="size-4" />
        </Button>
    </div>

    {#if expanded}
        <div class="flex flex-col gap-4 border-t bg-muted/20 p-4">
            <div class="space-y-1.5">
                <Label class="text-xs">Code</Label>
                <Textarea
                    class="min-h-48 resize-y bg-background font-mono text-sm leading-relaxed"
                    value={item.code}
                    placeholder="// Write character JavaScript behavior here..."
                    onchange={(e) => onUpdate(item.id, { code: e.currentTarget.value })}
                />
            </div>
        </div>
    {/if}
</div>
