<script lang="ts">
    import { Download, Trash2 } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';

    type ExportFormat = 'risu' | 'keipersona-light' | 'keipersona-baked';

    interface Props {
        showLightExport: boolean;
        exporting: string | null;
        deleting: boolean;
        onExportRisu: () => void | Promise<void>;
        onExportLight: () => void | Promise<void>;
        onExportBaked: () => void | Promise<void>;
        onDelete: () => void | Promise<void>;
    }

    let {
        showLightExport,
        exporting,
        deleting,
        onExportRisu,
        onExportLight,
        onExportBaked,
        onDelete
    }: Props = $props();

    let selectedFormat = $state<ExportFormat>('risu');

    interface FormatOption {
        id: ExportFormat;
        label: string;
        description: string;
        action: () => void | Promise<void>;
    }

    const formatOptions = $derived.by<FormatOption[]>(() => {
        const list: FormatOption[] = [
            {
                id: 'risu',
                label: 'Risu PNG (.png)',
                description: 'Persona image with portable Risu metadata.',
                action: onExportRisu
            }
        ];
        if (showLightExport) {
            list.push({
                id: 'keipersona-light',
                label: 'Kei Light (.keipersona)',
                description: 'Compact KeiAI archive that references synchronized assets.',
                action: onExportLight
            });
        }
        list.push({
            id: 'keipersona-baked',
            label: 'Kei Baked (.keipersona)',
            description: 'Self-contained KeiAI archive with assets included.',
            action: onExportBaked
        });
        return list;
    });

    const activeOption = $derived(
        formatOptions.find((opt) => opt.id === selectedFormat) ?? formatOptions[0]
    );

    function handleExportClick() {
        const opt = activeOption;
        if (!opt) return;
        void opt.action();
    }
</script>

<div class="space-y-6">
    <section class="space-y-3">
        <h3 class="text-sm font-semibold">Export Persona</h3>
        <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
                <div class="min-w-0 flex-1">
                    <select
                        id="export-persona-format"
                        class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={selectedFormat}
                        onchange={(e) => (selectedFormat = e.currentTarget.value as ExportFormat)}
                    >
                        {#each formatOptions as opt (opt.id)}
                            <option value={opt.id}>{opt.label}</option>
                        {/each}
                    </select>
                </div>
                <Button
                    variant="outline"
                    class="gap-1.5 shrink-0"
                    disabled={exporting !== null}
                    onclick={handleExportClick}
                >
                    <Download class="size-4" /> Export
                </Button>
            </div>
            {#if activeOption?.description}
                <p class="text-xs text-muted-foreground">{activeOption.description}</p>
            {/if}
        </div>
    </section>

    <section class="space-y-3">
        <h3 class="text-sm font-semibold text-destructive">Danger Zone</h3>
        <div
            class="flex flex-col gap-4 rounded-lg border border-destructive/30 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
            <div>
                <p class="text-sm font-medium">Delete this persona</p>
                <p class="mt-1 text-xs text-muted-foreground">
                    This removes the local persona and its owned assets.
                </p>
            </div>
            <Button
                variant="destructive"
                class="gap-1.5"
                disabled={deleting}
                aria-busy={deleting}
                onclick={onDelete}
            >
                <Trash2 class="size-4" /> Delete Persona
            </Button>
        </div>
    </section>
</div>
