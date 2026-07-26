<script lang="ts">
    import { activeUser, updateUser } from '$lib/stores';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
        CardDescription
    } from '$lib/components/ui/card';
    import { Label } from '$lib/components/ui/label';
    import * as Avatar from '$lib/components/ui/avatar';
    import MediaGalleryDialog from '$lib/components/MediaGalleryDialog.svelte';
    import type { MediaGalleryItem } from '$lib/components/MediaGalleryDialog.svelte';
    import { Trash2, Upload, UserRoundPen } from 'lucide-svelte';
    import { getErrorMessage } from '$lib/types/errors';
    import { IMAGE_ASSET_EXTENSIONS } from '$lib/types/asset';
    import { blobToDataUrl, preprocessImage } from '$lib/utils/image';
    import { MultiRoomService } from '$lib/services';
    import { formatPublicKeyFingerprint } from '$lib/crypto';
    import { appDialog } from '$lib/adapters/dialog';
    import { toast } from '$lib/ui';

    const AVATAR_MAX_SIZE = 5 * 1024 * 1024;
    const AVATAR_IMAGE_SIZE = 512;
    const AVATAR_WEBP_QUALITY = 0.85;

    let userName = $state('');
    let avatarDraft = $state<string | null>(null);

    let loading = $state(false);
    let avatarPicking = $state(false);
    let avatarPreviewOpen = $state(false);
    let identityFingerprint = $state('');
    let profileUserId: string | null = null;
    let actionVersion = 0;
    const displayedAvatar = $derived(
        avatarDraft === null ? ($activeUser?.avatar ?? '') : avatarDraft
    );
    const canPreviewAvatar = $derived(displayedAvatar.length > 0);
    const avatarPreviewItems = $derived<MediaGalleryItem[]>(
        canPreviewAvatar
            ? [
                  {
                      id: 'profile-avatar',
                      name: `${userName || 'Profile'} avatar`,
                      src: displayedAvatar,
                      mimeType: getDataUrlMimeType(displayedAvatar) ?? 'image/*'
                  }
              ]
            : []
    );

    function getDataUrlMimeType(src: string): string | undefined {
        return /^data:([^;,]+)/.exec(src)?.[1];
    }

    $effect(() => {
        const user = $activeUser;
        const userId = user?.id ?? null;
        if (userId === profileUserId) return;
        profileUserId = userId;
        actionVersion++;
        userName = user?.name ?? '';
        avatarDraft = null;
        loading = false;
        avatarPicking = false;
    });

    $effect(() => {
        const userId = $activeUser?.id;
        if (userId) {
            void MultiRoomService.getOwnPublicKeyFingerprint()
                .then((fingerprint) => {
                    if ($activeUser?.id !== userId) return;
                    identityFingerprint = formatPublicKeyFingerprint(fingerprint);
                })
                .catch(() => {
                    if ($activeUser?.id !== userId) return;
                    identityFingerprint = '';
                });
        } else {
            identityFingerprint = '';
        }
    });

    async function handleAvatarUpload() {
        if (avatarPicking || loading) return;
        const userId = $activeUser?.id;
        if (!userId) return;
        const version = ++actionVersion;
        avatarPicking = true;

        try {
            const file = await appDialog.openFile({
                title: 'Upload Profile Avatar',
                filters: [{ name: 'Images', extensions: [...IMAGE_ASSET_EXTENSIONS] }]
            });
            if (!file || $activeUser?.id !== userId || version !== actionVersion) return;
            if (file.size > AVATAR_MAX_SIZE) {
                toast.error({
                    title: 'Could not use avatar',
                    description: 'Avatar image must be under 5MB'
                });
                return;
            }
            const { blob } = await preprocessImage(file, {
                maxWidth: AVATAR_IMAGE_SIZE,
                maxHeight: AVATAR_IMAGE_SIZE,
                quality: AVATAR_WEBP_QUALITY
            });
            if ($activeUser?.id !== userId || version !== actionVersion) return;
            const avatar = await blobToDataUrl(blob);
            if ($activeUser?.id !== userId || version !== actionVersion) return;
            avatarDraft = avatar;
        } catch (e) {
            if ($activeUser?.id !== userId || version !== actionVersion) return;
            toast.error({ title: 'Could not prepare avatar', description: getErrorMessage(e) });
        } finally {
            if ($activeUser?.id === userId && version === actionVersion) avatarPicking = false;
        }
    }

    function handleAvatarRemove() {
        if (avatarPicking || loading || !displayedAvatar) return;
        avatarDraft = '';
    }

    async function handleUpdateUser() {
        if (loading || avatarPicking) return;
        const userId = $activeUser?.id;
        if (!userId) return;
        const version = ++actionVersion;
        loading = true;

        try {
            await updateUser({
                name: userName.trim(),
                ...(avatarDraft === null ? {} : { avatar: avatarDraft })
            });
            if ($activeUser?.id !== userId || version !== actionVersion) return;
            avatarDraft = null;
            toast.success({ title: 'Profile saved' });
        } catch (e) {
            if ($activeUser?.id !== userId || version !== actionVersion) return;
            toast.error({ title: 'Could not save profile', description: getErrorMessage(e) });
        } finally {
            if ($activeUser?.id === userId && version === actionVersion) loading = false;
        }
    }
</script>

<Card>
    <CardHeader>
        <CardTitle>User Profile</CardTitle>
        <CardDescription>
            Your profile is stored locally and syncs to your devices securely via PocketBase.
        </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4" aria-busy={loading || avatarPicking}>
        <div class="mb-2 flex items-center gap-4 sm:gap-6">
            <div class="shrink-0">
                <button
                    type="button"
                    class="rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 {canPreviewAvatar
                        ? 'cursor-zoom-in hover:brightness-95'
                        : 'cursor-default'}"
                    disabled={!canPreviewAvatar}
                    aria-label={canPreviewAvatar
                        ? `View ${userName || 'profile'} avatar`
                        : 'Default profile avatar'}
                    title={canPreviewAvatar ? 'View avatar' : undefined}
                    onclick={() => (avatarPreviewOpen = true)}
                >
                    <Avatar.Root
                        class="size-20 border-2 border-muted transition-colors hover:border-primary sm:size-24"
                    >
                        <Avatar.Image src={displayedAvatar} alt={userName} class="object-cover" />
                        <Avatar.Fallback class="text-xl font-bold"
                            >{(userName || 'U').charAt(0).toUpperCase()}</Avatar.Fallback
                        >
                    </Avatar.Root>
                </button>
            </div>

            <div class="min-w-0 flex-1 space-y-2">
                <Label>Display Name</Label>
                <Input
                    bind:value={userName}
                    placeholder="Your display name"
                    disabled={loading || avatarPicking}
                />
                <div class="flex flex-wrap gap-1">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        class="gap-1 px-2"
                        disabled={loading || avatarPicking}
                        aria-busy={avatarPicking}
                        onclick={handleAvatarUpload}
                    >
                        <Upload class="size-4" /> Upload avatar
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        class="gap-1 px-2"
                        disabled={loading || avatarPicking || !displayedAvatar}
                        onclick={handleAvatarRemove}
                    >
                        <Trash2 class="size-4" /> Remove avatar
                    </Button>
                </div>
            </div>
        </div>

        {#if identityFingerprint}
            <div class="space-y-2">
                <Label>Identity Fingerprint</Label>
                <div class="rounded-md border bg-muted/30 px-3 py-2 font-mono text-sm">
                    {identityFingerprint}
                </div>
            </div>
        {/if}

        <Button
            class="w-full"
            disabled={loading || avatarPicking || !userName.trim()}
            aria-busy={loading}
            onclick={handleUpdateUser}
        >
            <UserRoundPen class="mr-2 size-4" /> Save Profile
        </Button>
    </CardContent>
</Card>

<MediaGalleryDialog
    bind:open={avatarPreviewOpen}
    items={avatarPreviewItems}
    title="Profile avatar"
/>
