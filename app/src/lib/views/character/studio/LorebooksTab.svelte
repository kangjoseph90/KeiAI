<script lang="ts">
    import { Book, Plus } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import type { Lorebook } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import LorebookItem from '../../modules/LorebookItem.svelte';

    interface Props {
        lorebooks: Lorebook[];
        onCreate: (data: DeepPartial<Lorebook>) => void | Promise<void>;
        onUpdate: (id: string, changes: DeepPartial<Lorebook>) => void | Promise<void>;
        onDelete: (id: string) => void | Promise<void>;
    }

    let { lorebooks, onCreate, onUpdate, onDelete }: Props = $props();
    let newLorebookName = $state('');

    async function handleAdd() {
        if (!newLorebookName.trim()) return;
        await onCreate({
            name: newLorebookName,
            keys: [],
            content: '',
            insertionDepth: 0,
            enabled: true
        });
        newLorebookName = '';
    }
</script>

<section class="space-y-6">
    <div class="flex items-center justify-between">
        <div>
            <h2 class="text-lg font-semibold">World Info / Lorebooks</h2>
            <p class="text-sm text-muted-foreground">
                On-demand facts and lore triggered by keywords.
            </p>
        </div>
        <div class="flex gap-2">
            <Input
                placeholder="Lorebook name..."
                class="w-48 h-9"
                bind:value={newLorebookName}
                onkeydown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <Button size="sm" class="gap-1.5" onclick={handleAdd}>
                <Plus class="size-4" /> Add
            </Button>
        </div>
    </div>

    <div class="space-y-4">
        {#each lorebooks as lb (lb.id)}
            <LorebookItem item={lb} {onUpdate} {onDelete} />
        {:else}
            <div class="text-center py-12 border-2 border-dashed rounded-lg">
                <Book class="size-8 text-muted-foreground/30 mx-auto mb-2" />
                <p class="text-sm text-muted-foreground">
                    No lorebooks attached to this character.
                </p>
            </div>
        {/each}
    </div>
</section>
