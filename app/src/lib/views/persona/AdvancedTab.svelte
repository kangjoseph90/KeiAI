<script lang="ts">
    import ExportTab from './ExportTab.svelte';

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

<ExportTab
    {showLightExport}
    {exporting}
    {deleting}
    {onExportRisu}
    {onExportLight}
    {onExportBaked}
    {onDelete}
/>
