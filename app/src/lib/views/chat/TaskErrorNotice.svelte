<script lang="ts">
    import { AlertCircle, X } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { cn } from '$lib/utils';
    import { t } from '$lib/stores';

    let {
        title,
        message,
        onDismiss,
        class: className = ''
    }: {
        title: string;
        message: string;
        onDismiss: () => void;
        class?: string;
    } = $props();
</script>

<div
    class={cn(
        'flex w-full min-w-0 items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive',
        className
    )}
    role="alert"
>
    <AlertCircle class="mt-0.5 size-4 shrink-0" />
    <div class="min-w-0 flex-1">
        <div class="font-medium">{title}</div>
        <div class="wrap-break-word text-xs opacity-80">{message}</div>
    </div>
    <Button
        variant="ghost"
        size="icon-sm"
        class="-mr-1 -mt-1 shrink-0 hover:bg-destructive/10 hover:text-destructive"
        onclick={onDismiss}
        aria-label={$t('chat.notice.dismiss', { title })}
        title={$t('tasks.center.dismiss')}
    >
        <X class="size-3.5" />
    </Button>
</div>
