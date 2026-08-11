<script lang="ts">
    import { Download, Trash2 } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import OptionSelect from '$lib/components/OptionSelect.svelte';
    import { t } from '$lib/stores';

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
                label: $t('persona.export.risuPngLabel'),
                description: $t('persona.export.risuPngDescription'),
                action: onExportRisu
            }
        ];
        if (showLightExport) {
            list.push({
                id: 'keipersona-light',
                label: $t('persona.export.keiLightLabel'),
                description: $t('persona.export.keiLightDescription'),
                action: onExportLight
            });
        }
        list.push({
            id: 'keipersona-baked',
            label: $t('persona.export.keiBakedLabel'),
            description: $t('persona.export.keiBakedDescription'),
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
            <h3 class="text-lg font-semibold tracking-tight text-foreground">
                {$t('persona.export.title')}
            </h3>
            <p class="text-sm text-muted-foreground">
                {$t('persona.export.description')}
            </p>
        </div>
        <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
                <div class="min-w-0 flex-1">
                    <OptionSelect
                        id="export-persona-format"
                        class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={selectedFormat}
                        options={formatOptions.map((opt) => ({ value: opt.id, label: opt.label }))}
                        onChange={(value) => (selectedFormat = value as ExportFormat)}
                    />
                </div>
                <Button
                    variant="outline"
                    class="gap-1.5 shrink-0"
                    disabled={exporting !== null}
                    onclick={handleExportClick}
                >
                    <Download class="size-4" />
                    {$t('persona.export.button')}
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
            <h3 class="text-lg font-semibold tracking-tight text-destructive">
                {$t('persona.export.dangerZone')}
            </h3>
            <p class="text-sm text-muted-foreground">
                {$t('persona.export.dangerZoneHelp')}
            </p>
        </div>

        <div class="divide-y divide-border">
            <div class="flex items-center justify-between py-2">
                <div class="space-y-0.5 pr-4">
                    <p class="text-sm font-medium text-foreground">
                        {$t('persona.export.deleteThis')}
                    </p>
                    <p class="text-xs text-muted-foreground">
                        {$t('persona.export.deleteHelp')}
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
                    {$t('persona.export.deleteButton')}
                </Button>
            </div>
        </div>
    </section>
</div>
