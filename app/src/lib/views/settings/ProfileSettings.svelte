<script lang="ts">
    import { activeUser, updateUser, t } from '$lib/stores';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';

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
                      name: $t('settings.profile.avatarAlt', {
                          name: userName || $t('settings.profile.profileFallback')
                      }),
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
                title: $t('settings.profile.uploadTitle'),
                filters: [
                    {
                        name: $t('common.fileFilters.images'),
                        extensions: [...IMAGE_ASSET_EXTENSIONS]
                    }
                ]
            });
            if (!file || $activeUser?.id !== userId || version !== actionVersion) return;
            if (file.size > AVATAR_MAX_SIZE) {
                toast.error({
                    title: $t('settings.profile.toast.avatarOversize'),
                    description: $t('settings.profile.toast.avatarOversizeBody')
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
            toast.error({
                title: $t('settings.profile.toast.prepareAvatar'),
                description: getErrorMessage(e)
            });
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
            toast.success({ title: $t('settings.profile.toast.saved') });
        } catch (e) {
            if ($activeUser?.id !== userId || version !== actionVersion) return;
            toast.error({
                title: $t('settings.profile.toast.saveFailed'),
                description: getErrorMessage(e)
            });
        } finally {
            if ($activeUser?.id === userId && version === actionVersion) loading = false;
        }
    }
</script>

<div class="space-y-8 pb-8">
    <section class="space-y-6">
        <div>
            <h3 class="text-lg font-semibold tracking-tight text-foreground">
                {$t('settings.profile.title')}
            </h3>
            <p class="text-sm text-muted-foreground">
                {$t('settings.profile.description')}
            </p>
        </div>

        <div class="flex flex-col gap-6" aria-busy={loading || avatarPicking}>
            <div class="flex items-center gap-4">
                <div class="shrink-0">
                    <button
                        type="button"
                        class="rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 {canPreviewAvatar
                            ? 'cursor-zoom-in hover:brightness-95'
                            : 'cursor-default'}"
                        disabled={!canPreviewAvatar}
                        aria-label={canPreviewAvatar
                            ? $t('settings.profile.avatarAlt', {
                                  name: userName || $t('settings.profile.profileFallback')
                              })
                            : $t('settings.profile.defaultAvatarAlt')}
                        title={canPreviewAvatar ? $t('settings.profile.viewAvatar') : undefined}
                        onclick={() => (avatarPreviewOpen = true)}
                    >
                        <Avatar.Root
                            class="size-20 border-2 border-muted transition-colors hover:border-primary"
                        >
                            <Avatar.Image
                                src={displayedAvatar}
                                alt={userName}
                                class="object-cover"
                            />
                            <Avatar.Fallback class="text-xl font-bold"
                                >{(userName || 'U').charAt(0).toUpperCase()}</Avatar.Fallback
                            >
                        </Avatar.Root>
                    </button>
                </div>

                <div class="min-w-0 flex-1 space-y-2">
                    <Label for="profile-display-name">{$t('settings.profile.displayName')}</Label>
                    <Input
                        id="profile-display-name"
                        bind:value={userName}
                        placeholder={$t('settings.profile.displayNamePlaceholder')}
                        disabled={loading || avatarPicking}
                    />
                    <div class="flex flex-wrap gap-1.5 pt-1">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            class="gap-1 px-2.5"
                            disabled={loading || avatarPicking}
                            aria-busy={avatarPicking}
                            onclick={handleAvatarUpload}
                        >
                            <Upload class="size-4" />
                            {$t('settings.profile.uploadAvatar')}
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            class="gap-1 px-2.5"
                            disabled={loading || avatarPicking || !displayedAvatar}
                            onclick={handleAvatarRemove}
                        >
                            <Trash2 class="size-4" />
                            {$t('settings.profile.removeAvatar')}
                        </Button>
                    </div>
                </div>
            </div>

            {#if identityFingerprint}
                <div class="space-y-1.5">
                    <Label>{$t('settings.profile.fingerprint')}</Label>
                    <div
                        class="rounded-md border border-input bg-muted/30 px-3 py-2 font-mono text-sm"
                    >
                        {identityFingerprint}
                    </div>
                </div>
            {/if}

            <div class="pt-2">
                <Button
                    disabled={loading || avatarPicking || !userName.trim()}
                    aria-busy={loading}
                    onclick={handleUpdateUser}
                >
                    <UserRoundPen class="mr-2 size-4" />
                    {$t('settings.profile.save')}
                </Button>
            </div>
        </div>
    </section>
</div>

<MediaGalleryDialog
    bind:open={avatarPreviewOpen}
    items={avatarPreviewItems}
    title={$t('settings.profile.galleryTitle')}
/>
