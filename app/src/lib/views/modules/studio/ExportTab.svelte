<script lang="ts">
    import { Download } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
    import type { ModuleFileExport } from '$lib/porters/module';

    type ExportButton = 'risu' | 'keimodule-light' | 'keimodule-baked';

    let {
        exporting,
        showLightExport,
        onExport
    }: {
        exporting: ExportButton | null;
        showLightExport: boolean;
        onExport: (id: ExportButton, request: ModuleFileExport) => void | Promise<void>;
    } = $props();
</script>

<section class="space-y-6">
    <Card>
        <CardHeader>
            <CardTitle>Export Module</CardTitle>
        </CardHeader>
        <CardContent class="divide-y p-0">
            <div class="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p class="text-sm font-medium">Risu Module</p>
                    <p class="mt-1 text-xs text-muted-foreground">
                        Portable RisuAI module archive (.risum).
                    </p>
                </div>
                <Button
                    variant="outline"
                    class="gap-1.5 sm:self-center"
                    disabled={exporting !== null}
                    onclick={() => onExport('risu', { kind: 'risu', format: 'risum' })}
                >
                    <Download class="size-4" /> Export Risu
                </Button>
            </div>
            {#if showLightExport}
                <div class="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p class="text-sm font-medium">Kei Light</p>
                        <p class="mt-1 text-xs text-muted-foreground">
                            Compact KeiAI archive that references synchronized assets.
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        class="gap-1.5 sm:self-center"
                        disabled={exporting !== null}
                        onclick={() =>
                            onExport('keimodule-light', {
                                kind: 'keimodule',
                                assetMode: 'light'
                            })}
                    >
                        <Download class="size-4" /> Export Light
                    </Button>
                </div>
            {/if}
            <div class="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p class="text-sm font-medium">Kei Baked</p>
                    <p class="mt-1 text-xs text-muted-foreground">
                        Self-contained KeiAI archive with assets included.
                    </p>
                </div>
                <Button
                    variant="outline"
                    class="gap-1.5 sm:self-center"
                    disabled={exporting !== null}
                    onclick={() =>
                        onExport('keimodule-baked', { kind: 'keimodule', assetMode: 'baked' })}
                >
                    <Download class="size-4" /> Export Baked
                </Button>
            </div>
        </CardContent>
    </Card>
</section>
