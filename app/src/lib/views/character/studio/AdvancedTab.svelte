<script lang="ts">
    import { Badge } from '$lib/components/ui/badge';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
        CardDescription
    } from '$lib/components/ui/card';
    import type { Character, CharacterContent } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';

    interface Props {
        character: Character;
        onUpdate: (changes: DeepPartial<CharacterContent>) => void | Promise<void>;
    }

    let { character, onUpdate }: Props = $props();
</script>

<section class="space-y-6">
    <Card>
        <CardHeader>
            <CardTitle>System & Technical</CardTitle>
            <CardDescription>Advanced behavior flags and variable defaults.</CardDescription>
        </CardHeader>
        <CardContent class="space-y-6">
            <div class="flex items-center justify-between p-4 border rounded-lg bg-muted/20">
                <div class="space-y-0.5">
                    <Label>Allow Low Level Access</Label>
                    <p class="text-xs text-muted-foreground">
                        Bypass standard safety filters and prompt constraints.
                    </p>
                </div>
                <input
                    type="checkbox"
                    class="size-5 rounded border-primary"
                    checked={character.allowLowLevel}
                    onchange={(e) => onUpdate({ allowLowLevel: e.currentTarget.checked })}
                />
            </div>

            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <h3 class="text-sm font-semibold">Initial Variable States</h3>
                    <Badge variant="outline">Advanced</Badge>
                </div>
                <div class="space-y-2">
                    {#each Object.entries(character.defaultVariables ?? {}) as [key, val] (key)}
                        <div class="flex gap-2">
                            <Input class="flex-1 font-mono text-xs h-9" value={key} readonly />
                            <Input
                                class="flex-1 text-xs h-9"
                                value={val}
                                oninput={(e) => {
                                    const next = {
                                        ...character.defaultVariables,
                                        [key]: e.currentTarget.value
                                    };
                                    onUpdate({ defaultVariables: next });
                                }}
                            />
                        </div>
                    {:else}
                        <p class="text-xs text-muted-foreground italic text-center py-4">
                            No default variables defined.
                        </p>
                    {/each}
                </div>
            </div>
        </CardContent>
    </Card>
</section>
