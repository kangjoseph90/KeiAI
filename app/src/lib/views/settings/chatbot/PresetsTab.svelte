<script lang="ts">
    import { Download, Trash2, Plus, Upload } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
    import { Separator } from '$lib/components/ui/separator';
    import { Badge } from '$lib/components/ui/badge';
    import { presets, activePreset, selectPreset, createPreset, deletePreset } from '$lib/stores';
    import { exportPresetFile, importPresetFile } from '$lib/managers/preset';
    import type { PresetFileExport } from '$lib/porters/preset';

    let newPresetName = $state('');
    let importInput = $state<HTMLInputElement>();
    let exportFormat = $state<'risup' | 'keipreset'>('risup');

    async function handleCreatePreset() {
        if (!newPresetName.trim()) return;
        const preset = await createPreset({ name: newPresetName });
        await selectPreset(preset.id);
        newPresetName = '';
    }

    async function handleImport(event: Event) {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        if (!file) return;
        await importPresetFile(file, { select: true });
        target.value = '';
    }

    function presetExportRequest(): PresetFileExport {
        if (exportFormat === 'keipreset') return { kind: 'keipreset' };
        return { kind: 'risu', format: exportFormat };
    }
</script>

<Card>
    <CardHeader>
        <CardTitle class="text-base">Preset Management</CardTitle>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
        <div class="flex gap-2">
            <Input bind:value={newPresetName} placeholder="New preset name..." />
            <Button onclick={handleCreatePreset} class="gap-1.5">
                <Plus class="size-4" /> Create
            </Button>
            <Button variant="outline" class="gap-1.5" onclick={() => importInput?.click()}>
                <Upload class="size-4" /> Import
            </Button>
            <input
                bind:this={importInput}
                type="file"
                accept=".risup,.risupreset,.keipreset,.json"
                class="hidden"
                onchange={handleImport}
            />
        </div>

        <Separator />

        <div class="flex flex-col gap-2">
            {#each $presets as preset (preset.id)}
                <div
                    class="flex items-center justify-between p-2 rounded-lg border {$activePreset?.id ===
                    preset.id
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50'}"
                >
                    <div class="flex flex-col">
                        <span class="text-sm font-medium">{preset.name}</span>
                        <span class="text-[10px] text-muted-foreground truncate max-w-[200px]"
                            >{preset.description || 'No description'}</span
                        >
                    </div>
                    <div class="flex items-center gap-2">
                        {#if $activePreset?.id !== preset.id}
                            <Button
                                size="sm"
                                variant="outline"
                                onclick={() => selectPreset(preset.id)}>Use</Button
                            >
                        {:else}
                            <Badge>Active</Badge>
                        {/if}
                        <select
                            bind:value={exportFormat}
                            class="h-8 rounded-md border bg-background px-2 text-xs"
                            aria-label="Preset export format"
                        >
                            <option value="risup">Risu .risup</option>
                            <option value="keipreset">Kei .keipreset</option>
                        </select>
                        <Button
                            size="sm"
                            variant="outline"
                            onclick={() => exportPresetFile(preset.id, presetExportRequest())}
                            aria-label="Export preset"
                        >
                            <Download class="size-4" />
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            class="h-8 w-8 p-0 text-destructive"
                            onclick={() => deletePreset(preset.id)}
                            aria-label="Delete preset"
                        >
                            <Trash2 class="size-4" />
                        </Button>
                    </div>
                </div>
            {/each}
        </div>
    </CardContent>
</Card>
