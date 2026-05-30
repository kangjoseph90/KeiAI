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

    const AVATAR_MAX_SIZE = 5 * 1024 * 1024;
    const AVATAR_IMAGE_SIZE = 512;
    const AVATAR_WEBP_QUALITY = 0.85;

    let userName = $state('');
    let userAvatar = $state('');
    let fileInputRef: HTMLInputElement;

    let loading = $state(false);
    let errorMsg = $state('');
    let successMsg = $state('');
    let identityFingerprint = $state('');

    $effect(() => {
        if ($activeUser && !userName) {
            userName = $activeUser.name;
        }
    });

    $effect(() => {
        if ($activeUser) {
            void MultiRoomService.getOwnPublicKeyFingerprint()
                .then((fingerprint) => {
                    identityFingerprint = formatPublicKeyFingerprint(fingerprint);
                })
                .catch(() => {
                    identityFingerprint = '';
                });
        }
    });

    async function handleAvatarUpload(event: Event) {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        if (!file) return;

        if (file.size > AVATAR_MAX_SIZE) {
            errorMsg = 'Avatar image must be under 5MB';
            return;
        }

        try {
            errorMsg = '';
            const { blob } = await preprocessImage(file, {
                maxWidth: AVATAR_IMAGE_SIZE,
                maxHeight: AVATAR_IMAGE_SIZE,
                quality: AVATAR_WEBP_QUALITY
            });
            userAvatar = await blobToDataUrl(blob);
        } catch (e) {
            errorMsg = getErrorMessage(e);
        }
    }

    async function handleUpdateUser() {
        loading = true;
        errorMsg = '';
        successMsg = '';

        try {
            await updateUser({
                name: userName,
                ...(userAvatar ? { avatar: userAvatar } : {})
            });
            successMsg = 'User updated successfully.';
        } catch (e) {
            errorMsg = getErrorMessage(e);
        } finally {
            loading = false;
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
    <CardContent class="flex flex-col gap-4">
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
                    onclick={() => fileInputRef.click()}
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
                    onclick={() => fileInputRef.click()}
                    class="absolute inset-0 bg-background/60 backdrop-blur-sm opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-full transition-opacity cursor-pointer"
                >
                    <Upload class="size-6 text-foreground" />
                </button>
            </div>

            <input
                bind:this={fileInputRef}
                type="file"
                accept="image/png, image/jpeg, image/webp"
                class="hidden"
                onchange={handleAvatarUpload}
            />

            <div class="flex-1 space-y-2">
                <Label>Display Name</Label>
                <Input bind:value={userName} placeholder="Your display name" />
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

        <Button class="w-full" disabled={loading || !userName} onclick={handleUpdateUser}>
            <UserRoundPen class="mr-2 size-4" /> Save Profile
        </Button>
    </CardContent>
</Card>
