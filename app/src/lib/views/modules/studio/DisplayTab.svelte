<script lang="ts">
    import { Label } from '$lib/components/ui/label';
    import { Textarea } from '$lib/components/ui/textarea';
    import { t } from '$lib/stores';
    import type { Module, ModuleContent } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';

    let {
        module,
        onUpdate
    }: {
        module: Module;
        onUpdate: (changes: DeepPartial<ModuleContent>) => void | Promise<void>;
    } = $props();
</script>

<div class="space-y-4">
    <div class="grid gap-1.5">
        <Label for="module-background-html">{$t('module.display.backgroundLabel')}</Label>
        <Textarea
            id="module-background-html"
            rows={12}
            value={module.backgroundHTML}
            oninput={(e) => onUpdate({ backgroundHTML: e.currentTarget.value })}
            placeholder={$t('module.display.backgroundPlaceholder')}
            class="font-mono text-sm"
        />
        <p class="text-xs text-muted-foreground">{$t('module.display.backgroundHelp')}</p>
    </div>

    <div class="grid gap-1.5">
        <Label for="module-message-css">{$t('module.display.cssLabel')}</Label>
        <Textarea
            id="module-message-css"
            rows={12}
            value={module.messageCSS}
            oninput={(e) => onUpdate({ messageCSS: e.currentTarget.value })}
            placeholder={$t('module.display.cssPlaceholder')}
            class="font-mono text-sm"
        />
        <p class="text-xs text-muted-foreground">{$t('module.display.cssHelp')}</p>
    </div>
</div>
