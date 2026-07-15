<script lang="ts">
    import { Dialog, DialogContent, DialogTitle } from '$lib/components/ui/dialog';

    let { fullscreen = false }: { fullscreen?: boolean } = $props();
</script>

<Dialog open>
    <DialogContent class={fullscreen ? 'app-dialog-fullscreen' : undefined}>
        <DialogTitle>Viewport test</DialogTitle>
        <p>Dialog content</p>
    </DialogContent>
</Dialog>
