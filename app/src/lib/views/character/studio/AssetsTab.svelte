<script lang="ts">
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
        CardDescription
    } from '$lib/components/ui/card';
    import AssetView from '$lib/components/AssetView.svelte';
    import type { Character } from '$lib/services';

    interface Props {
        character: Character;
    }

    let { character }: Props = $props();
</script>

<section class="space-y-6">
    <Card>
        <CardHeader>
            <CardTitle>Asset Management</CardTitle>
            <CardDescription
                >Manage images and files associated with this character.</CardDescription
            >
        </CardHeader>
        <CardContent>
            <p class="text-sm text-muted-foreground mb-4">
                Character currently uses {(character.assets ?? []).length} explicit asset references.
            </p>
            <div class="grid grid-cols-4 gap-4 sm:grid-cols-6 md:grid-cols-8">
                {#if character.avatarAssetId}
                    <div class="aspect-square rounded-lg border overflow-hidden relative group">
                        <AssetView id={character.avatarAssetId} class="size-full object-cover" />
                        <div
                            class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center p-2 text-[10px] text-white"
                        >
                            <span>Active Avatar</span>
                        </div>
                    </div>
                {/if}
            </div>
        </CardContent>
    </Card>
</section>
