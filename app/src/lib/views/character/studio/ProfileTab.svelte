<script lang="ts">
    import { UserRound, Upload } from 'lucide-svelte';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import SyntaxTextarea from '$lib/components/SyntaxTextarea.svelte';
    import { Button } from '$lib/components/ui/button';
    import MediaView from '$lib/components/MediaView.svelte';
    import AssetViewerDialog from '$lib/components/AssetViewerDialog.svelte';
    import type { AssetViewerItem } from '$lib/components/AssetViewerDialog.svelte';
    import type { Character, CharacterContent } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { getErrorMessage } from '$lib/types/errors';
    import { IMAGE_ASSET_EXTENSIONS } from '$lib/types/asset';
    import { appDialog } from '$lib/adapters/dialog';
    import { appConfirm, toast } from '$lib/ui';
    import { t } from '$lib/stores';

    interface Props {
        character: Character;
        onUpdate: (changes: DeepPartial<CharacterContent>) => void | Promise<void>;
        onUpdateAvatar: (characterId: string, file: File) => void | Promise<void>;
        onRemoveAvatar: (characterId: string) => void | Promise<void>;
    }

    let { character, onUpdate, onUpdateAvatar, onRemoveAvatar }: Props = $props();
    let avatarAction = $state<'upload' | 'remove' | null>(null);
    let avatarGalleryOpen = $state(false);
    let avatarGalleryItems = $derived<AssetViewerItem[]>(
        character.avatar
            ? [
                  {
                      id: 'avatar',
                      name: character.avatar.name,
                      asset: {
                          scopeType: character.scopeType,
                          scopeId: character.scopeId,
                          ownerTable: 'characters',
                          ownerId: character.id,
                          hash: character.avatar.hash,
                          encKey: character.avatar.encKey,
                          mimeType: character.avatar.mimeType
                      }
                  }
              ]
            : []
    );

    async function handleAvatarUpload() {
        if (avatarAction) return;
        const characterId = character.id;
        avatarAction = 'upload';
        try {
            const file = await appDialog.openFile({
                title: $t('character.profile.uploadAvatarTitle'),
                filters: [
                    {
                        name: $t('common.fileFilters.images'),
                        extensions: [...IMAGE_ASSET_EXTENSIONS]
                    }
                ]
            });
            if (!file || character.id !== characterId) return;
            await onUpdateAvatar(characterId, file);
        } catch (error) {
            toast.error({
                title: $t('character.toast.updateAvatar'),
                description: getErrorMessage(error)
            });
        } finally {
            avatarAction = null;
        }
    }

    async function handleAvatarRemove() {
        if (!character.avatar || avatarAction) return;
        const characterId = character.id;
        avatarAction = 'remove';
        try {
            const confirmed = await appConfirm({
                title: $t('character.profile.removeAvatarTitle'),
                description: $t('character.profile.removeAvatarBody', { name: character.name }),
                confirmText: $t('common.actions.remove'),
                variant: 'destructive'
            });
            if (!confirmed || character.id !== characterId) return;
            await onRemoveAvatar(characterId);
        } catch (error) {
            toast.error({
                title: $t('character.toast.removeAvatar'),
                description: getErrorMessage(error)
            });
        } finally {
            avatarAction = null;
        }
    }
</script>

<div class="space-y-4">
    <div class="flex items-center gap-4">
        <div class="shrink-0">
            {#if character.avatar}
                <button
                    type="button"
                    class="size-20 cursor-zoom-in overflow-hidden rounded-full border-2 border-primary/20 bg-muted transition hover:border-primary/50 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-label={$t('character.profile.viewNamedAvatar', { name: character.name })}
                    title={$t('character.profile.viewAvatar')}
                    onclick={() => (avatarGalleryOpen = true)}
                >
                    <MediaView
                        asset={avatarGalleryItems[0]?.asset}
                        alt={character.name}
                        class="size-full object-cover"
                        fallback="none"
                        focus="top"
                    />
                </button>
            {:else}
                <div
                    class="size-20 overflow-hidden rounded-full border-2 border-primary/20 bg-muted"
                >
                    <MediaView
                        asset={null}
                        alt={character.name}
                        class="size-full object-cover"
                        fallback="none"
                        focus="top"
                    >
                        <div class="flex size-full items-center justify-center">
                            <UserRound class="size-10 text-muted-foreground/50" />
                        </div>
                    </MediaView>
                </div>
            {/if}
        </div>
        <div class="min-w-0 flex-1 space-y-3">
            <div class="grid gap-1.5">
                <Label for="character-name">{$t('character.profile.nameLabel')}</Label>
                <Input
                    id="character-name"
                    value={character.name}
                    oninput={(e) => onUpdate({ name: e.currentTarget.value })}
                    placeholder={$t('character.profile.namePlaceholder')}
                />
            </div>
            <div class="flex flex-wrap items-center gap-1">
                <Button
                    variant="outline"
                    size="sm"
                    class="gap-1 px-2"
                    disabled={avatarAction !== null}
                    aria-busy={avatarAction === 'upload'}
                    onclick={handleAvatarUpload}
                >
                    <Upload class="size-4" />
                    {$t('character.profile.uploadAvatarButton')}
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    class="gap-1 px-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    disabled={!character.avatar || avatarAction !== null}
                    aria-busy={avatarAction === 'remove'}
                    onclick={handleAvatarRemove}
                >
                    {$t('character.profile.removeAvatarButton')}
                </Button>
            </div>
        </div>
    </div>

    <div class="grid gap-1.5">
        <Label for="character-description">{$t('character.profile.descriptionLabel')}</Label>
        <SyntaxTextarea
            id="character-description"
            minRows={10}
            language="markdown"
            template
            value={character.description}
            oninput={(e) => onUpdate({ description: e.currentTarget.value })}
            placeholder={$t('character.profile.descriptionPlaceholder')}
        />
    </div>

    <div class="grid gap-1.5">
        <Label for="character-note">{$t('character.profile.noteLabel')}</Label>
        <SyntaxTextarea
            id="character-note"
            minRows={10}
            language="markdown"
            template
            value={character.characterNote}
            oninput={(e) => onUpdate({ characterNote: e.currentTarget.value })}
            placeholder={$t('character.profile.notePlaceholder')}
            class="font-mono text-sm"
        />
    </div>
</div>

<AssetViewerDialog
    bind:open={avatarGalleryOpen}
    items={avatarGalleryItems}
    title={$t('character.profile.avatar')}
/>
