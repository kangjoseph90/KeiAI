<script lang="ts">
    import { Download } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import type { ModuleFileExport } from '$lib/porters/module';

    type ExportButton = 'risu-charx' | 'risu-legacy' | 'keimodule-light' | 'keimodule-baked';

    interface Props {
        exporting: ExportButton | null;
        showLightExport: boolean;
        onExport: (id: ExportButton, request: ModuleFileExport) => void | Promise<void>;
    }

    let { exporting, showLightExport, onExport }: Props = $props();

    let selectedFormat = $state<ExportButton>('risu-charx');

    interface FormatOption {
        id: ExportButton;
        label: string;
        description: string;
        request: ModuleFileExport;
    }

    const formatOptions = $derived.by<FormatOption[]>(() => {
        const list: FormatOption[] = [
            {
                id: 'risu-charx',
                label: 'Risu CHARX (.charx)',
                description: 'Current RisuAI module format with embedded assets.',
                request: { kind: 'risu', format: 'charx' }
            },
            {
                id: 'risu-legacy',
                label: 'Legacy Risu Module (.risum)',
                description: 'Legacy RisuAI module archive for older clients.',
                request: { kind: 'risu', format: 'risum' }
            }
        ];
        if (showLightExport) {
            list.push({
                id: 'keimodule-light',
                label: 'Kei Light (.keimodule)',
                description: 'Compact KeiAI archive referencing synchronized assets.',
                request: { kind: 'keimodule', assetMode: 'light' }
            });
        }
        list.push({
            id: 'keimodule-baked',
            label: 'Kei Baked (.keimodule)',
            description: 'Self-contained KeiAI archive with assets included.',
            request: { kind: 'keimodule', assetMode: 'baked' }
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
        <h3 class="text-lg font-semibold tracking-tight text-foreground">Export Module</h3>
        <p class="text-sm text-muted-foreground">
            Export module data or archive with embedded assets.
        </p>
    </div>
    <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
            <div class="min-w-0 flex-1">
                <select
                    id="export-module-format"
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
