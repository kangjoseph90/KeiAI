<script lang="ts">
    import { Plus } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Label } from '$lib/components/ui/label';
    import { Separator } from '$lib/components/ui/separator';
    import {
        presetScripts,
        createPresetScript,
        updatePresetScript,
        deletePresetScript
    } from '$lib/stores';
    import type { Preset, Script } from '$lib/services';
    import ScriptItem from '../../modules/ScriptItem.svelte';

    interface Props {
        preset: Preset;
    }

    let { preset }: Props = $props();

    // ── Script Actions ──────────────────────────────────────────────
    let currentScripts = $state<Script[]>([]);

    $effect(() => {
        const unsub = presetScripts.subscribe((v) => (currentScripts = v));
        return unsub;
    });

    async function handleAddScript() {
        await createPresetScript(preset.id, { name: 'New Script' });
    }
</script>

<div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
        <h4 class="text-sm font-medium">Post-processing Scripts</h4>
        <Button size="sm" variant="outline" class="h-8 gap-1.5" onclick={handleAddScript}>
            <Plus class="size-3.5" /> Add Script
        </Button>
    </div>

    <div class="flex flex-col gap-3">
        {#each currentScripts as script (script.id)}
            <ScriptItem
                item={script}
                onUpdate={(id, changes) => updatePresetScript(preset.id, id, changes)}
                onDelete={(id) => deletePresetScript(preset.id, id)}
            />
        {:else}
            <div
                class="bg-muted/30 rounded-lg p-8 text-center text-muted-foreground border border-dashed"
            >
                <p class="text-sm">No scripts defined for this preset.</p>
                <p class="text-[10px] mt-1">
                    Scripts allow you to modify prompts and responses using regex.
                </p>
            </div>
        {/each}
    </div>
</div>
