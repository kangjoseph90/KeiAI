<script lang="ts">
    import { Trash2 } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Label } from '$lib/components/ui/label';
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
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

<section class="space-y-6">
    <Card>
        <CardHeader>
            <CardTitle>Runtime & Access</CardTitle>
        </CardHeader>
        <CardContent class="space-y-6">
            <div class="flex items-center justify-between gap-4 rounded-md border p-4">
                <div class="space-y-0.5">
                    <Label>Allow Low Level Access</Label>
                    <p class="text-xs text-muted-foreground">
                        Bypass standard safety filters and prompt constraints.
                    </p>
                </div>
                <input
                    type="checkbox"
                    class="size-5 shrink-0 rounded border-primary"
                    checked={character.allowLowLevel}
                    onchange={(e) => onUpdate({ allowLowLevel: e.currentTarget.checked })}
                />
            </div>

            <div class="space-y-1.5">
                <Label class="text-xs">Default Variables</Label>
                <KeyValueEditor
                    emptyMessage="No initial variables defined."
                    data={character.defaultVariables}
                    onUpdateValue={handleUpdateVariableValue}
                    onAdd={handleAddVariable}
                    onRemove={handleDeleteVariable}
                />
            </div>
        </CardContent>
    </Card>

    <ExportTab {exporting} {showLightExport} {onExport} />

    <Card class="border-destructive/40">
        <CardHeader>
            <CardTitle class="text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
                <p class="text-sm font-medium">Delete this character</p>
                <p class="mt-1 text-xs text-muted-foreground">
                    This removes the character and its owned resources.
                </p>
            </div>
            <Button
                variant="destructive"
                class="gap-1.5"
                disabled={deleting}
                aria-busy={deleting}
                onclick={onDelete}
            >
                <Trash2 class="size-4" /> Delete Character
            </Button>
        </CardContent>
    </Card>
</section>
