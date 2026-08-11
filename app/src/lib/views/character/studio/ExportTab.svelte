<script lang="ts">
    import { Download } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Label } from '$lib/components/ui/label';
    import OptionSelect from '$lib/components/OptionSelect.svelte';
    import type { ExportCharacterFileRequest } from '$lib/managers';
    import { t } from '$lib/stores';

    type ExportButton = 'ccv3-png' | 'ccv3-charx' | 'keichar-light' | 'keichar-baked';

    interface Props {
        exporting: ExportButton | null;
        showLightExport: boolean;
        onExport: (id: ExportButton, request: ExportCharacterFileRequest) => void | Promise<void>;
    }

    let { exporting, showLightExport, onExport }: Props = $props();

    let selectedFormat = $state<ExportButton>('ccv3-png');

    interface FormatOption {
        id: ExportButton;
        label: string;
        description: string;
        request: ExportCharacterFileRequest;
    }

    const formatOptions = $derived.by<FormatOption[]>(() => {
        const list: FormatOption[] = [
            {
                id: 'ccv3-png',
                label: $t('character.export.v3PngLabel'),
                description: $t('character.export.v3PngDescription'),
                request: { kind: 'ccv3', format: 'png' }
            },
            {
                id: 'ccv3-charx',
                label: $t('character.export.v3CharxLabel'),
                description: $t('character.export.v3CharxDescription'),
                request: { kind: 'ccv3', format: 'charx' }
            }
        ];
        if (showLightExport) {
            list.push({
                id: 'keichar-light',
                label: $t('character.export.keiLightLabel'),
                description: $t('character.export.keiLightDescription'),
                request: { kind: 'keichar', assetMode: 'light' }
            });
        }
        list.push({
            id: 'keichar-baked',
            label: $t('character.export.keiBakedLabel'),
            description: $t('character.export.keiBakedDescription'),
            request: { kind: 'keichar', assetMode: 'baked' }
        });
        return list;
    });

    const activeOption = $derived(
        formatOptions.find((opt) => opt.id === selectedFormat) ?? formatOptions[0]
    );

    function handleExportClick() {
        const opt = activeOption;
        if (!opt) return;
        void onExport(opt.id, opt.request);
    }
</script>

<section class="space-y-4">
    <div>
        <h3 class="text-lg font-semibold tracking-tight text-foreground">
            {$t('character.export.title')}
        </h3>
        <p class="text-sm text-muted-foreground">
            {$t('character.export.description')}
        </p>
    </div>
    <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
            <div class="min-w-0 flex-1">
                <OptionSelect
                    id="export-character-format"
                    class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={selectedFormat}
                    options={formatOptions.map((opt) => ({ value: opt.id, label: opt.label }))}
                    onChange={(value) => (selectedFormat = value as ExportButton)}
                />
            </div>
            <Button
                variant="outline"
                class="gap-1.5 shrink-0"
                disabled={exporting !== null}
                onclick={handleExportClick}
            >
                <Download class="size-4" />
                {$t('character.export.button')}
            </Button>
        </div>
        {#if activeOption?.description}
            <p class="text-xs text-muted-foreground">{activeOption.description}</p>
        {/if}
    </div>
</section>
