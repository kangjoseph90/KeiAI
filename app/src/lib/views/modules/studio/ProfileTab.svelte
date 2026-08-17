<script lang="ts">
    import { Input } from '$lib/components/ui/input';
    import { t } from '$lib/stores';
    import { Label } from '$lib/components/ui/label';
    import SyntaxTextarea from '$lib/components/SyntaxTextarea.svelte';
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
        <Label for="module-name">{$t('module.profile.nameLabel')}</Label>
        <Input
            id="module-name"
            value={module.name}
            oninput={(e) => onUpdate({ name: e.currentTarget.value })}
            placeholder={$t('module.profile.namePlaceholder')}
        />
    </div>

    <div class="grid gap-1.5">
        <Label for="module-description">{$t('module.profile.descriptionLabel')}</Label>
        <SyntaxTextarea
            id="module-description"
            ariaLabel={$t('module.profile.descriptionLabel')}
            minRows={6}
            language="markdown"
            value={module.description}
            oninput={(e) => onUpdate({ description: e.currentTarget.value })}
            placeholder={$t('module.profile.descriptionPlaceholder')}
        />
    </div>
</div>
