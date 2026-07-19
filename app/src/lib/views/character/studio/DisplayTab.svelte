<script lang="ts">
    import { Label } from '$lib/components/ui/label';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
    import type { Character, CharacterContent } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';

    let {
        character,
        onUpdate
    }: {
        character: Character;
        onUpdate: (changes: DeepPartial<CharacterContent>) => void | Promise<void>;
    } = $props();
</script>

<section class="space-y-6">
    <Card>
        <CardHeader>
            <CardTitle>Chat Display</CardTitle>
        </CardHeader>
        <CardContent class="space-y-6">
            <div class="grid gap-1.5">
                <Label>Background HTML</Label>
                <Textarea
                    rows={12}
                    value={character.backgroundHTML}
                    oninput={(e) => onUpdate({ backgroundHTML: e.currentTarget.value })}
                    placeholder="&lt;style&gt;...&lt;/style&gt;"
                    class="font-mono text-sm"
                />
                <p class="text-xs text-muted-foreground">
                    Rendered behind the chat surface with enabled global modules.
                </p>
            </div>

            <div class="grid gap-1.5">
                <Label>Message CSS</Label>
                <Textarea
                    rows={12}
                    value={character.messageCSS}
                    oninput={(e) => onUpdate({ messageCSS: e.currentTarget.value })}
                    placeholder=".status-panel &#123; ... &#125;"
                    class="font-mono text-sm"
                />
                <p class="text-xs text-muted-foreground">
                    CSS body only. It is scoped to messages rendered for this character.
                </p>
            </div>
        </CardContent>
    </Card>
</section>
