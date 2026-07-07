<script lang="ts">
    import ExportTab from './ExportTab.svelte';

    let {
        showLightExport,
        onExportRisu,
        onExportLight,
        onExportBaked,
        onDelete
    }: {
        showLightExport: boolean;
        onExportRisu: () => void | Promise<void>;
        onExportLight: () => void | Promise<void>;
        onExportBaked: () => void | Promise<void>;
        onDelete: () => void | Promise<void>;
    } = $props();
</script>

<ExportTab {showLightExport} {onExportRisu} {onExportLight} {onExportBaked} {onDelete} />
