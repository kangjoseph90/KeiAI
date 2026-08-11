<script lang="ts">
    import { Trash2 } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Label } from '$lib/components/ui/label';
    import type { Character, CharacterContent } from '$lib/services';
    import type { ExportCharacterFileRequest } from '$lib/managers';
    import type { DeepPartial } from '$lib/utils/defaults';
    import ExportTab from './ExportTab.svelte';
    import KeyValueEditor from '$lib/components/KeyValueEditor.svelte';
    import { t } from '$lib/stores';

    type ExportButton = 'ccv3-png' | 'ccv3-charx' | 'keichar-light' | 'keichar-baked';

    let {
        character,
        exporting,
        deleting,
        showLightExport,
        onUpdate,
        onExport,
        onDelete
    }: {
        character: Character;
        exporting: ExportButton | null;
        deleting: boolean;
        showLightExport: boolean;
        onUpdate: (changes: DeepPartial<CharacterContent>) => void | Promise<void>;
        onExport: (id: ExportButton, request: ExportCharacterFileRequest) => void | Promise<void>;
        onDelete: () => void | Promise<void>;
    } = $props();

    async function handleAddVariable(key: string, value: string) {
        await onUpdate({ defaultVariables: { [key]: value } });
    }

    async function handleDeleteVariable(key: string) {
        await onUpdate({ defaultVariables: { [key]: undefined } });
    }

    async function handleUpdateVariableValue(key: string, value: string) {
        await onUpdate({ defaultVariables: { [key]: value } });
    }
</script>

<div class="space-y-8 pb-8">
    <section class="space-y-6">
        <div>
            <h3 class="text-lg font-semibold tracking-tight text-foreground">
                {$t('character.advanced.title')}
            </h3>
            <p class="text-sm text-muted-foreground">
                {$t('character.advanced.description')}
            </p>
        </div>

        <div class="divide-y divide-border">
            <div class="flex items-center justify-between pb-4">
                <div class="space-y-0.5 pr-4">
                    <Label
                        for="character-allow-low-level"
                        class="text-sm font-medium cursor-pointer"
                    >
                        {$t('character.advanced.lowLevel')}
                    </Label>
                    <p class="text-xs text-muted-foreground">
                        {$t('character.advanced.lowLevelHelp')}
                    </p>
                </div>
                <input
                    id="character-allow-low-level"
                    type="checkbox"
                    class="size-5 shrink-0 rounded border-primary cursor-pointer"
                    checked={character.allowLowLevel}
                    onchange={(e) => onUpdate({ allowLowLevel: e.currentTarget.checked })}
                />
            </div>
        </div>

        <div class="space-y-2">
            <Label class="text-sm font-medium">{$t('character.advanced.variables')}</Label>
            <KeyValueEditor
                emptyMessage={$t('character.advanced.variablesEmpty')}
                data={character.defaultVariables}
                onUpdateValue={handleUpdateVariableValue}
                onAdd={handleAddVariable}
                onRemove={handleDeleteVariable}
            />
        </div>
    </section>

    <div class="border-t border-border"></div>

    <ExportTab {exporting} {showLightExport} {onExport} />

    <div class="border-t border-border"></div>

    <section class="space-y-4">
        <div>
            <h3 class="text-lg font-semibold tracking-tight text-destructive">
                {$t('character.advanced.dangerZone')}
            </h3>
            <p class="text-sm text-muted-foreground">
                {$t('character.advanced.dangerZoneHelp')}
            </p>
        </div>

        <div class="divide-y divide-border">
            <div class="flex items-center justify-between py-2">
                <div class="space-y-0.5 pr-4">
                    <p class="text-sm font-medium text-foreground">
                        {$t('character.advanced.deleteThis')}
                    </p>
                    <p class="text-xs text-muted-foreground">
                        {$t('character.advanced.deleteHelp')}
                    </p>
                </div>
                <Button
                    variant="destructive"
                    class="gap-1.5 shrink-0"
                    disabled={deleting}
                    aria-busy={deleting}
                    onclick={onDelete}
                >
                    <Trash2 class="size-4" />
                    {$t('character.advanced.deleteButton')}
                </Button>
            </div>
        </div>
    </section>
</div>
