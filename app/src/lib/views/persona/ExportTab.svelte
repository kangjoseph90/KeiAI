<script lang="ts">
    import { Download, Trash2 } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

    let {
        showLightExport,
        exporting,
        deleting,
        onExportRisu,
        onExportLight,
        onExportBaked,
        onDelete
    }: {
        showLightExport: boolean;
        exporting: string | null;
        deleting: boolean;
        onExportRisu: () => void | Promise<void>;
        onExportLight: () => void | Promise<void>;
        onExportBaked: () => void | Promise<void>;
        onDelete: () => void | Promise<void>;
    } = $props();
</script>

<section class="space-y-5">
    <Card>
        <CardHeader>
            <CardTitle>Export Persona</CardTitle>
        </CardHeader>
        <CardContent class="divide-y p-0">
            <div class="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p class="text-sm font-medium">Risu PNG</p>
                    <p class="mt-1 text-xs text-muted-foreground">
                        Persona image with portable Risu metadata.
                    </p>
                </div>
                <Button
                    variant="outline"
                    class="gap-1.5"
                    disabled={exporting !== null}
                    aria-busy={exporting === 'risu'}
                    onclick={onExportRisu}
                >
                    <Download class="size-4" /> Export PNG
                </Button>
            </div>
            {#if showLightExport}
                <div class="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p class="text-sm font-medium">Kei Light</p>
                        <p class="mt-1 text-xs text-muted-foreground">
                            Compact KeiAI archive that references synchronized assets.
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        class="gap-1.5"
                        disabled={exporting !== null}
                        aria-busy={exporting === 'keipersona-light'}
                        onclick={onExportLight}
                    >
                        <Download class="size-4" /> Export Light
                    </Button>
                </div>
            {/if}
            <div class="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p class="text-sm font-medium">Kei Baked</p>
                    <p class="mt-1 text-xs text-muted-foreground">
                        Self-contained KeiAI archive with assets included.
                    </p>
                </div>
                <Button
                    variant="outline"
                    class="gap-1.5"
                    disabled={exporting !== null}
                    aria-busy={exporting === 'keipersona-baked'}
                    onclick={onExportBaked}
                >
                    <Download class="size-4" /> Export Baked
                </Button>
            </div>
        </CardContent>
    </Card>

    <Card class="border-destructive/40">
        <CardHeader>
            <CardTitle class="text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
        </CardContent>
    </Card>
</section>
