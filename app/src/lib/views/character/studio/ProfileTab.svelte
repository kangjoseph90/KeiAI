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
    import type { Character, CharacterContent } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { getErrorMessage } from '$lib/types/errors';
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

    async function handleAvatarUpload() {
        if (avatarAction) return;
        const characterId = character.id;
        avatarAction = 'upload';
        try {
            const file = await appDialog.openFile({
                title: 'Upload Character Avatar',
                filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
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
            <div class="flex items-center gap-6">
                <div class="relative group">
                    <div
                        class="size-24 rounded-full border-2 border-primary/20 overflow-hidden bg-muted"
                    >
                        <AssetView
                            asset={character.avatar
                                ? {
                                      scopeType: character.scopeType,
                                      scopeId: character.scopeId,
                                      ownerTable: 'characters',
                                      ownerId: character.id,
                                      hash: character.avatar.hash,
                                      encKey: character.avatar.encKey
                                  }
                                : null}
                            alt={character.name}
                            class="size-full object-cover"
                            fallback="none"
                        >
                            {#if !character.avatar}
                                <div class="flex size-full items-center justify-center">
                                    <User class="size-10 text-muted-foreground/50" />
                                </div>
                            {/if}
                        </AssetView>
                    </div>
                    <button
                        class="absolute inset-0 flex items-center justify-center bg-black/40 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        disabled={avatarAction !== null}
                        aria-busy={avatarAction === 'upload'}
                        aria-label="Upload character avatar"
                        onclick={handleAvatarUpload}
                    >
                        <Upload class="size-6" />
                    </button>
                </div>
                <div class="flex-1 space-y-4">
                    <div class="grid gap-1.5">
                        <Label>Character Name</Label>
                        <Input
                            value={character.name}
                            oninput={(e) => onUpdate({ name: e.currentTarget.value })}
                            placeholder="Enter character name..."
                        />
                    </div>
                    <div class="flex items-center gap-2">
                        <Button
                            variant="destructive"
                            size="sm"
                            disabled={!character.avatar || avatarAction !== null}
                            aria-busy={avatarAction === 'remove'}
                            onclick={handleAvatarRemove}
                        >
                            Remove Avatar
                        </Button>
                    </div>
                </div>
            </div>

            <div class="grid gap-1.5">
                <Label>Description</Label>
                <Textarea
                    rows={3}
                    value={character.description}
                    oninput={(e) => onUpdate({ description: e.currentTarget.value })}
                    placeholder="A short description of who this character is..."
                />
                <p class="text-xs text-muted-foreground">Used for character lists and cards.</p>
            </div>

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
