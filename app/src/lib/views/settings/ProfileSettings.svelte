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
    import { Upload, UserRoundPen } from 'lucide-svelte';
    import { getErrorMessage } from '$lib/types/errors';
    import { blobToDataUrl, preprocessImage } from '$lib/utils/image';
    import { MultiRoomService } from '$lib/services';
    import { formatPublicKeyFingerprint } from '$lib/crypto';
    import { appDialog } from '$lib/adapters/dialog';
    import { toast } from '$lib/ui';

    const AVATAR_MAX_SIZE = 5 * 1024 * 1024;
    const AVATAR_IMAGE_SIZE = 512;
    const AVATAR_WEBP_QUALITY = 0.85;

    let userName = $state('');
    let userAvatar = $state('');

    let loading = $state(false);
    let avatarPicking = $state(false);
    let errorMsg = $state('');
    let successMsg = $state('');
    let identityFingerprint = $state('');
    let profileUserId: string | null = null;
    let actionVersion = 0;

    $effect(() => {
        const user = $activeUser;
        const userId = user?.id ?? null;
        if (userId === profileUserId) return;
        profileUserId = userId;
        actionVersion++;
        userName = user?.name ?? '';
        userAvatar = '';
        loading = false;
        avatarPicking = false;
        errorMsg = '';
        successMsg = '';
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
            errorMsg = '';
            const file = await appDialog.openFile({
                title: 'Upload Profile Avatar',
                filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
            });
            if (!file || $activeUser?.id !== userId || version !== actionVersion) return;
            if (file.size > AVATAR_MAX_SIZE) {
                errorMsg = 'Avatar image must be under 5MB';
                toast.error({ title: 'Could not use avatar', description: errorMsg });
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
            userAvatar = avatar;
        } catch (e) {
            if ($activeUser?.id !== userId || version !== actionVersion) return;
            errorMsg = getErrorMessage(e);
            toast.error({ title: 'Could not prepare avatar', description: errorMsg });
        } finally {
            if ($activeUser?.id === userId && version === actionVersion) avatarPicking = false;
        }
    }

    async function handleUpdateUser() {
        if (loading || avatarPicking) return;
        const userId = $activeUser?.id;
        if (!userId) return;
        const version = ++actionVersion;
        loading = true;
        errorMsg = '';
        successMsg = '';

        try {
            await updateUser({
                name: userName.trim(),
                ...(userAvatar ? { avatar: userAvatar } : {})
            });
            if ($activeUser?.id !== userId || version !== actionVersion) return;
            successMsg = 'User updated successfully.';
        } catch (e) {
            if ($activeUser?.id !== userId || version !== actionVersion) return;
            errorMsg = getErrorMessage(e);
            toast.error({ title: 'Could not save profile', description: errorMsg });
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
        {#if errorMsg}
            <div
                class="rounded-md bg-destructive/15 p-3 text-sm text-destructive border border-destructive/20 font-medium"
            >
                {errorMsg}
            </div>
        {/if}

        {#if successMsg}
            <div
                class="rounded-md bg-green-500/15 p-3 text-sm text-green-600 dark:text-green-400 border border-green-500/20 font-medium"
            >
                {successMsg}
            </div>
        {/if}

        <div class="flex items-center gap-6 mb-2">
            <div class="relative group">
                <Avatar.Root
                    class="size-20 border-2 border-muted hover:border-primary transition-colors cursor-pointer"
                >
                    <!-- Show selected data URL if present, otherwise existing avatar -->
                    <Avatar.Image
                        src={userAvatar || $activeUser?.avatar}
                        alt={userName}
                        class="object-cover"
                    />
                    <Avatar.Fallback class="text-xl font-bold"
                        >{(userName || 'U').charAt(0).toUpperCase()}</Avatar.Fallback
                    >
                </Avatar.Root>
                <button
                    type="button"
                    onclick={handleAvatarUpload}
                    disabled={loading || avatarPicking}
                    aria-busy={avatarPicking}
                    aria-label="Upload profile avatar"
                    class="absolute inset-0 bg-background/60 backdrop-blur-sm opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-full transition-opacity cursor-pointer"
                >
                    <Upload class="size-6 text-foreground" />
                </button>
            </div>

            <div class="flex-1 space-y-2">
                <Label>Display Name</Label>
                <Input
                    bind:value={userName}
                    placeholder="Your display name"
                    disabled={loading || avatarPicking}
                />
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
