<script lang="ts">
    import { modules, createModule } from '$lib/stores';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Plus } from 'lucide-svelte';
    import ModuleCard from '../modules/ModuleCard.svelte';

    let newName = $state('');

    async function handleCreate() {
        if (!newName.trim()) return;
        await createModule({ name: newName, description: '' });
        newName = '';
    }
</script>

<div class="flex flex-col gap-4">
    <div class="flex gap-2">
        <Input
            bind:value={newName}
            placeholder="New module name"
            class="flex-1"
            onkeydown={(e) => e.key === 'Enter' && handleCreate()}
        />
        <Button class="gap-1.5" onclick={handleCreate}>
            <Plus class="size-4" /> Create
        </Button>
    </div>

    <div class="flex flex-col gap-2">
        {#each $modules as mod (mod.id)}
            <ModuleCard {mod} />
        {:else}
            <p class="text-sm text-muted-foreground">No modules found.</p>
        {/each}
    </div>
</div>
