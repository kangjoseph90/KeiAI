<script lang="ts">
    import { Trash2 } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Label } from '$lib/components/ui/label';
    import type { Module, ModuleContent } from '$lib/services';
    import type { ModuleFileExport } from '$lib/porters/module';
    import type { DeepPartial } from '$lib/utils/defaults';
    import ExportTab from './ExportTab.svelte';
    import KeyValueEditor from '$lib/components/KeyValueEditor.svelte';

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

<div class="space-y-8 pb-8">
    <section class="space-y-6">
        <div>
            <h3 class="text-lg font-semibold tracking-tight text-foreground">Advanced Options</h3>
            <p class="text-sm text-muted-foreground">
                Configure global runtime state, low-level access, and initial variables for this
                module.
            </p>
        </div>

        <div class="divide-y divide-border">
            <div class="flex items-center justify-between py-3.5">
                <div class="space-y-0.5 pr-4">
                    <Label for="module-enabled-globally" class="text-sm font-medium cursor-pointer">
                        Enabled globally
                    </Label>
                    <p class="text-xs text-muted-foreground">
                        Turn this module runtime on or off globally.
                    </p>
                </div>
                <input
                    id="module-enabled-globally"
                    type="checkbox"
                    class="size-5 shrink-0 rounded border-primary cursor-pointer"
                    checked={enabled}
                    onchange={(e) => onToggleEnabled(e.currentTarget.checked)}
                />
            </div>

            <div class="flex items-center justify-between py-3.5">
                <div class="space-y-0.5 pr-4">
                    <Label for="module-allow-low-level" class="text-sm font-medium cursor-pointer">
                        Allow Low Level Access
                    </Label>
                    <p class="text-xs text-muted-foreground">
                        Bypass standard safety filters and prompt constraints.
                    </p>
                </div>
                <input
                    id="module-allow-low-level"
                    type="checkbox"
                    class="size-5 shrink-0 rounded border-primary cursor-pointer"
                    checked={module.allowLowLevel}
                    onchange={(e) => onUpdate({ allowLowLevel: e.currentTarget.checked })}
                />
            </div>
        </div>

        <div class="space-y-2">
            <Label class="text-sm font-medium">Default Variables</Label>
            <KeyValueEditor
                emptyMessage="No initial variables defined."
                data={module.defaultVariables}
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
            <p class="text-sm text-muted-foreground">Irreversible actions for this module.</p>
        </div>

        <div class="divide-y divide-border">
            <div class="flex items-center justify-between py-2">
                <div class="space-y-0.5 pr-4">
                    <p class="text-sm font-medium text-foreground">Delete this module</p>
                    <p class="text-xs text-muted-foreground">
                        This removes the module and its owned resources permanently.
                    </p>
                </div>
                <Button
                    variant="destructive"
                    class="gap-1.5 shrink-0"
                    disabled={deleting}
                    aria-busy={deleting}
                    onclick={onDelete}
                >
                    <Trash2 class="size-4" /> Delete Module
                </Button>
            </div>
        </div>
    </section>
</div>
