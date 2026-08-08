<script lang="ts">
    import { Download } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Label } from '$lib/components/ui/label';
    import type { ExportCharacterFileRequest } from '$lib/managers';

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
                label: 'Character Card V3 (PNG)',
                description: 'Portable character card with embedded metadata.',
                request: { kind: 'ccv3', format: 'png' }
            },
            {
                id: 'ccv3-charx',
                label: 'Character Card V3 (CharX)',
                description: 'Archive format for character data and related assets.',
                request: { kind: 'ccv3', format: 'charx' }
            }
        ];
        if (showLightExport) {
            list.push({
                id: 'keichar-light',
                label: 'Kei Light (.keichar)',
                description: 'Compact KeiAI archive that references synchronized assets.',
                request: { kind: 'keichar', assetMode: 'light' }
            });
        }
        list.push({
            id: 'keichar-baked',
            label: 'Kei Baked (.keichar)',
            description: 'Self-contained KeiAI archive with assets included.',
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
        <h3 class="text-lg font-semibold tracking-tight text-foreground">Export Character</h3>
        <p class="text-sm text-muted-foreground">
            Export character card or archive with embedded metadata.
        </p>
    </div>
    <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
            <div class="min-w-0 flex-1">
                <select
                    id="export-character-format"
                    class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={selectedFormat}
                    onchange={(e) => (selectedFormat = e.currentTarget.value as ExportButton)}
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
