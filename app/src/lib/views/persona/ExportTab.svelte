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

<div class="space-y-8 pb-8">
    <section class="space-y-4">
        <div>
            <h3 class="text-lg font-semibold tracking-tight text-foreground">Export Persona</h3>
            <p class="text-sm text-muted-foreground">
                Export persona card or archive with embedded assets.
            </p>
        </div>
        <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
                <div class="min-w-0 flex-1">
                    <select
                        id="export-persona-format"
                        class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

    <div class="border-t border-border"></div>

    <section class="space-y-4">
        <div>
            <h3 class="text-lg font-semibold tracking-tight text-destructive">Danger Zone</h3>
            <p class="text-sm text-muted-foreground">Irreversible actions for this persona.</p>
        </div>

        <div class="divide-y divide-border">
            <div class="flex items-center justify-between py-2">
                <div class="space-y-0.5 pr-4">
                    <p class="text-sm font-medium text-foreground">Delete this persona</p>
                    <p class="text-xs text-muted-foreground">
                        This removes the local persona and its owned assets permanently.
                    </p>
                </div>
                <Button
                    variant="destructive"
                    class="gap-1.5 shrink-0"
                    disabled={deleting}
                    aria-busy={deleting}
                    onclick={onDelete}
                >
                    <Trash2 class="size-4" /> Delete Persona
                </Button>
            </div>
        </div>
    </section>
</div>
