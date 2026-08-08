<script lang="ts">
    import { Trash2 } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Label } from '$lib/components/ui/label';
    import type { Character, CharacterContent } from '$lib/services';
    import type { ExportCharacterFileRequest } from '$lib/managers';
    import type { DeepPartial } from '$lib/utils/defaults';
    import ExportTab from './ExportTab.svelte';
    import KeyValueEditor from '$lib/components/KeyValueEditor.svelte';

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
            <h3 class="text-lg font-semibold tracking-tight text-foreground">Advanced Options</h3>
            <p class="text-sm text-muted-foreground">
                Configure low-level access and initial variables for this character.
            </p>
        </div>

        <div class="divide-y divide-border">
            <div class="flex items-center justify-between pb-4">
                <div class="space-y-0.5 pr-4">
                    <Label
                        for="character-allow-low-level"
                        class="text-sm font-medium cursor-pointer"
                    >
                        Allow Low Level Access
                    </Label>
                    <p class="text-xs text-muted-foreground">
                        Bypass standard safety filters and prompt constraints.
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
            <Label class="text-sm font-medium">Default Variables</Label>
            <KeyValueEditor
                emptyMessage="No initial variables defined."
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
            <h3 class="text-lg font-semibold tracking-tight text-destructive">Danger Zone</h3>
            <p class="text-sm text-muted-foreground">Irreversible actions for this character.</p>
        </div>

        <div class="divide-y divide-border">
            <div class="flex items-center justify-between py-2">
                <div class="space-y-0.5 pr-4">
                    <p class="text-sm font-medium text-foreground">Delete this character</p>
                    <p class="text-xs text-muted-foreground">
                        This removes the character and its owned resources permanently.
                    </p>
                </div>
                <Button
                    variant="destructive"
                    class="gap-1.5 shrink-0"
                    disabled={deleting}
                    aria-busy={deleting}
                    onclick={onDelete}
                >
                    <Trash2 class="size-4" /> Delete Character
                </Button>
            </div>
        </div>
    </section>
</div>
