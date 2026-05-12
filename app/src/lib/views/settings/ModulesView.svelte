<script lang="ts">
    import {
        modules,
        createModule,
        deleteModule,
        appSettings,
        setModuleEnabled
    } from '$lib/stores';
    import { navigate } from '$lib/router';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Card, CardContent } from '$lib/components/ui/card';
    import { Badge } from '$lib/components/ui/badge';
    import { Pencil, Plus, Trash2 } from 'lucide-svelte';
    import ModuleCard from '../modules/ModuleCard.svelte';

    let { moduleId }: { moduleId?: string } = $props();

    let newName = $state('');

    const selectedModule = $derived(
        moduleId ? ($modules.find((mod) => mod.id === moduleId) ?? null) : null
    );

    async function handleCreate() {
        const name = newName.trim();
        if (!name) return;
        const mod = await createModule({ name, description: '' });
        newName = '';
        navigate({ view: 'settings', moduleId: mod.id });
    }
</script>

{#if selectedModule}
    <ModuleCard mod={selectedModule} />
{:else if moduleId}
    <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <p class="text-sm text-muted-foreground">Module not found.</p>
        <Button variant="outline" onclick={() => navigate({ view: 'settings' })}>Back</Button>
    </div>
{:else}
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
                {@const enabled = $appSettings?.modules.refs[mod.id]?.enabled ?? true}
                <Card>
                    <CardContent class="flex items-center justify-between gap-3 p-4">
                        <button
                            class="min-w-0 flex-1 text-left"
                            onclick={() => navigate({ view: 'settings', moduleId: mod.id })}
                        >
                            <div class="flex items-center gap-2">
                                <p class="font-medium">{mod.name || 'Unnamed'}</p>
                                {#if !enabled}
                                    <Badge variant="outline" class="text-xs">Disabled</Badge>
                                {/if}
                            </div>
                            {#if mod.description}
                                <p class="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                                    {mod.description}
                                </p>
                            {/if}
                        </button>
                        <div class="flex shrink-0 items-center gap-1">
                            <label class="flex items-center gap-1.5 text-sm">
                                <input
                                    type="checkbox"
                                    checked={enabled}
                                    onchange={() => setModuleEnabled(mod.id, !enabled)}
                                />
                            </label>
                            <Button
                                size="sm"
                                variant="outline"
                                onclick={() => navigate({ view: 'settings', moduleId: mod.id })}
                            >
                                <Pencil class="size-4" />
                            </Button>
                            <Button
                                size="sm"
                                variant="destructive"
                                onclick={() => deleteModule(mod.id)}
                            >
                                <Trash2 class="size-4" />
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            {:else}
                <p class="text-sm text-muted-foreground">No modules found.</p>
            {/each}
        </div>
    </div>
{/if}
