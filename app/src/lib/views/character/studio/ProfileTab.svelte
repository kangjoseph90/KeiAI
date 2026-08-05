<script lang="ts">
    import { User, Upload } from 'lucide-svelte';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Button } from '$lib/components/ui/button';
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
        CardDescription
    } from '$lib/components/ui/card';
    import AssetView from '$lib/components/AssetView.svelte';
    import MediaGalleryDialog from '$lib/components/MediaGalleryDialog.svelte';
    import type { MediaGalleryItem } from '$lib/components/MediaGalleryDialog.svelte';
    import type { Character, CharacterContent } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { getErrorMessage } from '$lib/types/errors';
    import { IMAGE_ASSET_EXTENSIONS } from '$lib/types/asset';
    import { appDialog } from '$lib/adapters/dialog';
    import { appConfirm, toast } from '$lib/ui';

    interface Props {
        character: Character;
        onUpdate: (changes: DeepPartial<CharacterContent>) => void | Promise<void>;
        onUpdateAvatar: (characterId: string, file: File) => void | Promise<void>;
        onRemoveAvatar: (characterId: string) => void | Promise<void>;
    }

    let { character, onUpdate, onUpdateAvatar, onRemoveAvatar }: Props = $props();
    let avatarAction = $state<'upload' | 'remove' | null>(null);
    let avatarGalleryOpen = $state(false);
    let avatarGalleryItems = $derived<MediaGalleryItem[]>(
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
                title: 'Upload Character Avatar',
                filters: [{ name: 'Images', extensions: [...IMAGE_ASSET_EXTENSIONS] }]
            });
            if (!file || character.id !== characterId) return;
            await onUpdateAvatar(characterId, file);
        } catch (error) {
            toast.error({ title: 'Could not update avatar', description: getErrorMessage(error) });
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
                title: 'Remove character avatar?',
                description: `Remove the avatar for "${character.name}"?`,
                confirmText: 'Remove',
                variant: 'destructive'
            });
            if (!confirmed || character.id !== characterId) return;
            await onRemoveAvatar(characterId);
        } catch (error) {
            toast.error({ title: 'Could not remove avatar', description: getErrorMessage(error) });
        } finally {
            avatarAction = null;
        }
    }
</script>

<section class="space-y-6">
    <Card>
        <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>How the character is identified in the application.</CardDescription>
        </CardHeader>
        <CardContent class="space-y-6">
            <div class="flex items-center gap-4 sm:gap-6">
                <div class="shrink-0">
                    {#if character.avatar}
                        <button
                            type="button"
                            class="size-20 cursor-zoom-in overflow-hidden rounded-full border-2 border-primary/20 bg-muted transition hover:border-primary/50 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:size-24"
                            aria-label={`View ${character.name} avatar`}
                            title="View avatar"
                            onclick={() => (avatarGalleryOpen = true)}
                        >
                            <AssetView
                                asset={avatarGalleryItems[0]?.asset}
                                alt={character.name}
                                class="size-full object-cover"
                                fallback="none"
                            />
                        </button>
                    {:else}
                        <div
                            class="size-20 overflow-hidden rounded-full border-2 border-primary/20 bg-muted sm:size-24"
                        >
                            <AssetView
                                asset={null}
                                alt={character.name}
                                class="size-full object-cover"
                                fallback="none"
                            >
                                <div class="flex size-full items-center justify-center">
                                    <User class="size-10 text-muted-foreground/50" />
                                </div>
                            </AssetView>
                        </div>
                    {/if}
                </div>
                <div class="min-w-0 flex-1 space-y-4">
                    <div class="grid gap-1.5">
                        <Label for="character-name">Character Name</Label>
                        <Input
                            id="character-name"
                            value={character.name}
                            oninput={(e) => onUpdate({ name: e.currentTarget.value })}
                            placeholder="Enter character name..."
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
                            <Upload class="size-4" /> Upload avatar
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            class="gap-1 px-2"
                            disabled={!character.avatar || avatarAction !== null}
                            aria-busy={avatarAction === 'remove'}
                            onclick={handleAvatarRemove}
                        >
                            Remove avatar
                        </Button>
                    </div>
                </div>
            </div>

            <div class="grid gap-1.5">
                <Label for="character-description">Description</Label>
                <Textarea
                    id="character-description"
                    rows={3}
                    value={character.description}
                    oninput={(e) => onUpdate({ description: e.currentTarget.value })}
                    placeholder="A short description of who this character is..."
                />
                <p class="text-xs text-muted-foreground">Used for character lists and cards.</p>
            </div>

            <div class="grid gap-1.5">
                <Label for="character-note">Character Note</Label>
                <Textarea
                    id="character-note"
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

<MediaGalleryDialog
    bind:open={avatarGalleryOpen}
    items={avatarGalleryItems}
    title="Character avatar"
/>
