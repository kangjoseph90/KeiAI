<script lang="ts">
    import { Download } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
    import type { ExportCharacterFileRequest } from '$lib/managers';

    type ExportButton = 'ccv3-png' | 'ccv3-charx' | 'keichar-light' | 'keichar-baked';

    let {
        exporting,
        showLightExport,
        onExport
    }: {
        exporting: ExportButton | null;
        showLightExport: boolean;
        onExport: (id: ExportButton, request: ExportCharacterFileRequest) => void | Promise<void>;
    } = $props();
</script>

<section class="space-y-6">
    <Card>
        <CardHeader>
            <CardTitle>Export Character</CardTitle>
        </CardHeader>
        <CardContent class="divide-y p-0">
            <div class="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p class="text-sm font-medium">Character Card V3 PNG</p>
                    <p class="mt-1 text-xs text-muted-foreground">
                        Portable character card with embedded metadata.
                    </p>
                </div>
                <Button
                    variant="outline"
                    class="gap-1.5 sm:self-center"
                    disabled={exporting !== null}
                    onclick={() => onExport('ccv3-png', { kind: 'ccv3', format: 'png' })}
                >
                    <Download class="size-4" /> Export PNG
                </Button>
            </div>
            <div class="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p class="text-sm font-medium">Character Card V3 CharX</p>
                    <p class="mt-1 text-xs text-muted-foreground">
                        Archive format for character data and related assets.
                    </p>
                </div>
                <Button
                    variant="outline"
                    class="gap-1.5 sm:self-center"
                    disabled={exporting !== null}
                    onclick={() => onExport('ccv3-charx', { kind: 'ccv3', format: 'charx' })}
                >
                    <Download class="size-4" /> Export CharX
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
                            onExport('keichar-light', {
                                kind: 'keichar',
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
                        onExport('keichar-baked', { kind: 'keichar', assetMode: 'baked' })}
                >
                    <Download class="size-4" /> Export Baked
                </Button>
            </div>
        </CardContent>
    </Card>
</section>
