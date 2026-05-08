<script lang="ts">
    import { Label } from '$lib/components/ui/label';
    import { Textarea } from '$lib/components/ui/textarea';
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
            <CardTitle>Character Prompting</CardTitle>
            <CardDescription>Core identity and behavior instructions.</CardDescription>
        </CardHeader>
        <CardContent class="space-y-6">
            <div class="grid gap-1.5">
                <Label>Character Note</Label>
                <Textarea
                    rows={15}
                    value={character.characterNote}
                    oninput={(e) => onUpdate({ characterNote: e.currentTarget.value })}
                    placeholder="Define the character's personality, speech patterns, and background..."
                    class="font-mono text-sm"
                />
                <p class="text-xs text-muted-foreground">
                    This is injected into the AI prompt to shape its personality.
                </p>
            </div>
        </CardContent>
    </Card>
</section>
