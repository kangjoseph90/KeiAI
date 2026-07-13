<script lang="ts">
    import ExportTab from './ExportTab.svelte';

    let {
        showLightExport,
        deleting,
        onExportRisu,
        onExportLight,
        onExportBaked,
        onDelete
    }: {
        showLightExport: boolean;
        deleting: boolean;
        onExportRisu: () => void | Promise<void>;
        onExportLight: () => void | Promise<void>;
        onExportBaked: () => void | Promise<void>;
        onDelete: () => void | Promise<void>;
    } = $props();
</script>

<ExportTab {showLightExport} {deleting} {onExportRisu} {onExportLight} {onExportBaked} {onDelete} />
