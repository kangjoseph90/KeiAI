<script lang="ts">
    import { Trash2 } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Label } from '$lib/components/ui/label';
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
    import type { Module, ModuleContent } from '$lib/services';
    import type { ModuleFileExport } from '$lib/porters/module';
    import type { DeepPartial } from '$lib/utils/defaults';
    import ExportTab from './ExportTab.svelte';
    import KeyValueEditor from '$lib/components/KeyValueEditor.svelte';

    type ExportButton = 'risu' | 'keimodule-light' | 'keimodule-baked';

    let {
        module,
        enabled,
        exporting,
        deleting,
        showLightExport,
        onUpdate,
        onToggleEnabled,
        onExport,
        onDelete
    }: {
        module: Module;
        enabled: boolean;
        exporting: ExportButton | null;
        deleting: boolean;
        showLightExport: boolean;
        onUpdate: (changes: DeepPartial<ModuleContent>) => void | Promise<void>;
        onToggleEnabled: (next: boolean) => void | Promise<void>;
        onExport: (id: ExportButton, request: ModuleFileExport) => void | Promise<void>;
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
                    <Label>Enabled globally</Label>
                    <p class="text-xs text-muted-foreground">
                        Turn this module runtime on or off globally.
                    </p>
                </div>
                <input
                    type="checkbox"
                    class="size-5 shrink-0 rounded border-primary"
                    checked={enabled}
                    onchange={(e) => onToggleEnabled(e.currentTarget.checked)}
                />
            </div>

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
                    checked={module.allowLowLevel}
                    onchange={(e) => onUpdate({ allowLowLevel: e.currentTarget.checked })}
                />
            </div>

            <div class="space-y-1.5">
                <Label class="text-xs">Default Variables</Label>
                <KeyValueEditor
                    emptyMessage="No initial variables defined."
                    data={module.defaultVariables}
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
                <p class="text-sm font-medium">Delete this module</p>
                <p class="mt-1 text-xs text-muted-foreground">
                    This removes the module and its owned resources.
                </p>
            </div>
            <Button
                variant="destructive"
                class="gap-1.5"
                disabled={deleting}
                aria-busy={deleting}
                onclick={onDelete}
            >
                <Trash2 class="size-4" /> Delete Module
            </Button>
        </CardContent>
    </Card>
</section>
