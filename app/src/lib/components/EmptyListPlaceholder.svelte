<script lang="ts">
    let { message }: { message: string } = $props();
</script>

<div class="rounded-lg border-2 border-dashed p-8 text-center text-sm text-muted-foreground">
    {message}
</div>
