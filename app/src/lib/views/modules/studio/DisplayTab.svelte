<script lang="ts">
    import { Label } from '$lib/components/ui/label';
    import SyntaxTextarea from '$lib/components/SyntaxTextarea.svelte';
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
        <SyntaxTextarea
            id="module-background-html"
            minRows={10}
            language="html"
            template
            value={module.backgroundHTML}
            oninput={(e) => onUpdate({ backgroundHTML: e.currentTarget.value })}
            placeholder={$t('module.display.backgroundPlaceholder')}
            class="font-mono text-sm"
        />
        <p class="text-xs text-muted-foreground">{$t('module.display.backgroundHelp')}</p>
    </div>

    <div class="grid gap-1.5">
        <Label for="module-message-css">{$t('module.display.cssLabel')}</Label>
        <SyntaxTextarea
            id="module-message-css"
            minRows={10}
            language="css"
            template
            value={module.messageCSS}
            oninput={(e) => onUpdate({ messageCSS: e.currentTarget.value })}
            placeholder={$t('module.display.cssPlaceholder')}
            class="font-mono text-sm"
        />
        <p class="text-xs text-muted-foreground">{$t('module.display.cssHelp')}</p>
    </div>
</div>
