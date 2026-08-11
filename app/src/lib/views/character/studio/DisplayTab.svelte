<script lang="ts">
    import { Label } from '$lib/components/ui/label';
    import { Textarea } from '$lib/components/ui/textarea';
    import type { Character, CharacterContent } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { t } from '$lib/stores';

    let {
        character,
        onUpdate
    }: {
        character: Character;
        onUpdate: (changes: DeepPartial<CharacterContent>) => void | Promise<void>;
    } = $props();
</script>

<div class="space-y-4">
    <div class="grid gap-1.5">
        <Label for="character-background-html">{$t('character.display.backgroundLabel')}</Label>
        <Textarea
            id="character-background-html"
            rows={12}
            value={character.backgroundHTML}
            oninput={(e) => onUpdate({ backgroundHTML: e.currentTarget.value })}
            placeholder={$t('character.display.backgroundPlaceholder')}
            class="font-mono text-sm"
        />
        <p class="text-xs text-muted-foreground">{$t('character.display.backgroundHelp')}</p>
    </div>

    <div class="grid gap-1.5">
        <Label for="character-message-css">{$t('character.display.cssLabel')}</Label>
        <Textarea
            id="character-message-css"
            rows={12}
            value={character.messageCSS}
            oninput={(e) => onUpdate({ messageCSS: e.currentTarget.value })}
            placeholder={$t('character.display.cssPlaceholder')}
            class="font-mono text-sm"
        />
        <p class="text-xs text-muted-foreground">
            {$t('character.display.cssHelp')}
        </p>
    </div>
</div>
