<script lang="ts">
    import { Trash2 } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Label } from '$lib/components/ui/label';
    import type { Module, ModuleContent } from '$lib/services';
    import type { ModuleFileExport } from '$lib/porters/module';
    import type { DeepPartial } from '$lib/utils/defaults';
    import ExportTab from './ExportTab.svelte';
    import KeyValueEditor from '$lib/components/KeyValueEditor.svelte';
    import SettingRow from '$lib/components/SettingRow.svelte';

    type ExportButton = 'risu-charx' | 'risu-legacy' | 'keimodule-light' | 'keimodule-baked';

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

<div class="space-y-6">
    <section class="space-y-4">
        <SettingRow>
            <div class="space-y-0.5">
                <Label for="module-enabled-globally">Enabled globally</Label>
                <p class="text-xs text-muted-foreground">
                    Turn this module runtime on or off globally.
                </p>
            </div>
            <input
                id="module-enabled-globally"
                type="checkbox"
                class="size-5 shrink-0 rounded border-primary"
                checked={enabled}
                onchange={(e) => onToggleEnabled(e.currentTarget.checked)}
            />
        </SettingRow>

        <SettingRow>
            <div class="space-y-0.5">
                <Label for="module-allow-low-level">Allow Low Level Access</Label>
                <p class="text-xs text-muted-foreground">
                    Bypass standard safety filters and prompt constraints.
                </p>
            </div>
            <input
                id="module-allow-low-level"
                type="checkbox"
                class="size-5 shrink-0 rounded border-primary"
                checked={module.allowLowLevel}
                onchange={(e) => onUpdate({ allowLowLevel: e.currentTarget.checked })}
            />
        </SettingRow>

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
    </section>

    <ExportTab {exporting} {showLightExport} {onExport} />

    <section class="space-y-3">
        <h3 class="text-sm font-semibold text-destructive">Danger Zone</h3>
        <div
            class="flex flex-col gap-4 rounded-lg border border-destructive/30 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
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
        </div>
    </section>
</div>
