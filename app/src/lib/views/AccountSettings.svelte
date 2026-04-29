<script lang="ts">
    import {
        isLoggedIn,
        isLocalOnly,
        isSyncLinked,
        isSyncServerConfigured,
        activeUser,
        username as activeUsername,
        userEmail,
        performCreateAccount,
        performSignIn,
        performRecoverAndReset,
        performDeleteWithRecoveryCode,
        performChangePassword,
        performUnlinkSync,
        performLogout,
        performPairWithCode,
        performSetSyncServerUrl
    } from '$lib/stores';
    import { AuthService } from '$lib/services/auth';
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
    import { Key, LogOut, Link, ShieldAlert, AlertTriangle } from 'lucide-svelte';
    import { getErrorMessage } from '$lib/types/errors';
    import { PB_URL } from '$lib/config';

    let email = $state('');
    let username = $state('');
    let password = $state('');
    let confirmPassword = $state('');
    let syncServerUrl = $derived($activeUser?.syncServerUrl ?? PB_URL);
    let recoveryCode = $state('');
    let newPassword = $state('');
    let pairingCodeInput = $state('');
    let generatedPairingCode = $state('');

    let loading = $state(false);
    let errorMsg = $state('');
    let successMsg = $state('');
    let displayRecovery = $state('');

    let mode = $state<
        | 'connect'
        | 'signin'
        | 'recover'
        | 'recover_delete'
        | 'pair_new'
        | 'change_server'
        | 'change_password'
        | 'unlink'
        | 'pair_existing'
    >('connect');

    // Auto-reset mode when auth state changes (e.g. after login, logout, unlink)
    $effect(() => {
        if (!$isLoggedIn) {
            if (
                ![
                    'connect',
                    'signin',
                    'recover',
                    'recover_delete',
                    'pair_new',
                    'change_server'
                ].includes(mode)
            )
                mode = 'connect';
        } else {
            if (!['change_password', 'unlink', 'pair_existing'].includes(mode))
                mode = 'change_password';
        }
    });

    async function runAction(action: () => Promise<void | string | null>, successText: string) {
        loading = true;
        errorMsg = '';
        successMsg = '';
        displayRecovery = '';
        try {
            const result = await action();
            if (typeof result === 'string') displayRecovery = result;
            successMsg = successText;
            email = '';
            username = '';
            password = '';
            confirmPassword = '';
            newPassword = '';
            recoveryCode = '';
            pairingCodeInput = '';
        } catch (e) {
            errorMsg = getErrorMessage(e);
        } finally {
            loading = false;
        }
    }

    function handleConnect() {
        if (password !== confirmPassword) {
            errorMsg = 'Passwords do not match.';
            return;
        }
        runAction(
            () => performCreateAccount(username, password, email || undefined),
            'Account created.'
        );
    }

    function handleSignIn() {
        runAction(() => performSignIn(username, password), 'Signed in successfully.');
    }

    function handleRecover() {
        if (newPassword !== confirmPassword) {
            errorMsg = 'Passwords do not match.';
            return;
        }
        runAction(
            () => performRecoverAndReset(recoveryCode, newPassword),
            'Device recovered. Save your new recovery code.'
        );
    }

    function handleRecoverDelete() {
        runAction(
            () => performDeleteWithRecoveryCode(recoveryCode),
            'Remote account deleted successfully. Local data remains intact.'
        );
    }

    function handleChangePassword() {
        runAction(
            () => performChangePassword(password, newPassword),
            'Password changed. Save your new recovery code.'
        );
    }

    function handleUnlink() {
        runAction(() => performUnlinkSync(), 'Sync disconnected. Local data remains available.');
    }

    function handleLogout() {
        runAction(() => performLogout(), 'Logged out successfully.');
    }

    async function handleGeneratePairing() {
        loading = true;
        errorMsg = '';
        generatedPairingCode = '';
        try {
            generatedPairingCode = await AuthService.createPairingCode();
        } catch (e) {
            errorMsg = getErrorMessage(e);
        } finally {
            loading = false;
        }
    }

    function handlePairNewDevice() {
        runAction(() => performPairWithCode(pairingCodeInput), 'Device paired successfully.');
    }

    function handleSetSyncServer() {
        runAction(
            () => performSetSyncServerUrl(syncServerUrl || undefined),
            'Sync server updated.'
        );
    }
</script>

<Card>
    <CardHeader>
        <CardTitle>Account & Synchronization</CardTitle>
        <CardDescription>
            {#if !$isLoggedIn}
                {#if $isLocalOnly}
                    {#if $isSyncServerConfigured}
                        Sync server selected. No account linked.
                    {:else}
                        You are using a local-only identity.
                    {/if}
                {:else if $isSyncLinked}
                    Signed out{#if $activeUsername}: <strong>@{$activeUsername}</strong>{/if}
                {:else}
                    Sync is not connected.
                {/if}
            {:else}
                Sync connected{#if $userEmail}: <strong>{$userEmail}</strong>{/if}
            {/if}
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

        {#if displayRecovery}
            <div
                class="rounded-md bg-amber-500/15 p-4 text-sm text-amber-700 dark:text-amber-400 border border-amber-500/20"
            >
                <div class="flex items-center gap-2 font-bold mb-2">
                    <ShieldAlert class="size-5" />
                    SAVE YOUR RECOVERY CODE NOW
                </div>
                <p class="mb-2">
                    If you forget your password, this is the ONLY way to recover your account data.
                    Write it down and keep it safe.
                </p>
                <div
                    class="bg-amber-100 dark:bg-amber-950/50 p-3 rounded font-mono text-center tracking-widest text-xl font-bold border border-amber-200 dark:border-amber-900 select-all"
                >
                    {displayRecovery}
                </div>
            </div>
        {/if}

        {#if !$isLoggedIn}
            <div class="rounded-md border p-3 text-sm flex flex-col gap-2">
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <div class="font-medium">Sync Server</div>
                        <div class="text-muted-foreground break-all">
                            {$activeUser?.syncServerUrl ?? PB_URL}
                        </div>
                    </div>
                    <Button variant="outline" size="sm" onclick={() => (mode = 'change_server')}>
                        Change
                    </Button>
                </div>
            </div>

            <div class="flex border-b mb-2">
                <button
                    class="px-4 py-2 font-medium text-sm border-b-2 {mode === 'connect'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground'}"
                    onclick={() => (mode = 'connect')}>Create Account</button
                >
                <button
                    class="px-4 py-2 font-medium text-sm border-b-2 {mode === 'signin'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground'}"
                    onclick={() => (mode = 'signin')}>Sign In</button
                >
                <button
                    class="px-4 py-2 font-medium text-sm border-b-2 {mode === 'recover'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground'}"
                    onclick={() => (mode = 'recover')}>Recover</button
                >
                <button
                    class="px-4 py-2 font-medium text-sm border-b-2 {mode === 'pair_new'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground'}"
                    onclick={() => (mode = 'pair_new')}>Pair Device</button
                >
            </div>

            {#if mode === 'change_server'}
                <div class="space-y-3">
                    <div class="space-y-1">
                        <Label>Sync Server URL</Label>
                        <Input
                            bind:value={syncServerUrl}
                            type="url"
                            placeholder="https://sync.example.com"
                        />
                    </div>
                    <Button class="w-full" disabled={loading} onclick={handleSetSyncServer}>
                        Save Sync Server
                    </Button>
                </div>
            {:else if mode === 'connect'}
                <div class="space-y-3">
                    {#if $isSyncLinked}
                        <div
                            class="mb-2 p-3 text-sm rounded bg-primary/10 text-primary border border-primary/20"
                        >
                            Create a sync account for this local identity.
                        </div>
                    {/if}
                    <div class="space-y-1">
                        <Label>Email (optional)</Label>
                        <Input bind:value={email} type="email" placeholder="updates@example.com" />
                    </div>
                    <div class="space-y-1">
                        <Label>Password</Label>
                        <Input bind:value={password} type="password" placeholder="••••••••" />
                    </div>
                    <div class="space-y-1">
                        <Label>Confirm Password</Label>
                        <Input
                            bind:value={confirmPassword}
                            type="password"
                            placeholder="••••••••"
                        />
                    </div>
                    <div class="space-y-1">
                        <Label>Username</Label>
                        <Input bind:value={username} type="text" placeholder="your-name" />
                    </div>
                    <Button class="w-full" disabled={loading} onclick={handleConnect}>
                        <Link class="mr-2 size-4" /> Create Account
                    </Button>
                </div>
            {:else if mode === 'signin'}
                <div class="space-y-3">
                    <div class="space-y-1">
                        <Label>Username</Label>
                        <Input bind:value={username} type="text" placeholder="your-name" />
                    </div>
                    <div class="space-y-1">
                        <Label>Password</Label>
                        <Input bind:value={password} type="password" placeholder="••••••••" />
                    </div>
                    <Button class="w-full" disabled={loading} onclick={handleSignIn}>
                        <Link class="mr-2 size-4" /> Sign In
                    </Button>
                </div>
            {:else if mode === 'recover'}
                <div class="space-y-3">
                    <p class="text-sm text-muted-foreground">
                        Use your recovery code to restore sync and set a new password.
                    </p>
                    <div class="space-y-1">
                        <Label>24-char Recovery Code</Label>
                        <Input
                            bind:value={recoveryCode}
                            type="text"
                            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                        />
                    </div>
                    <div class="space-y-1">
                        <Label>New Password</Label>
                        <Input bind:value={newPassword} type="password" placeholder="••••••••" />
                    </div>
                    <div class="space-y-1">
                        <Label>Confirm New Password</Label>
                        <Input
                            bind:value={confirmPassword}
                            type="password"
                            placeholder="••••••••"
                        />
                    </div>
                    <Button class="w-full" disabled={loading} onclick={handleRecover}>
                        <Key class="mr-2 size-4" /> Recover Device & Reset Password
                    </Button>
                    <div class="text-center pt-2">
                        <Button
                            variant="link"
                            class="text-xs text-muted-foreground"
                            onclick={() => (mode = 'recover_delete')}
                        >
                            Or delete remote account completely
                        </Button>
                    </div>
                </div>
            {:else if mode === 'recover_delete'}
                <div class="space-y-3 p-4 border border-destructive/30 bg-destructive/5 rounded-lg">
                    <h3 class="font-bold flex items-center gap-2 text-destructive">
                        <AlertTriangle class="size-4" /> Delete Remote Account
                    </h3>
                    <p class="text-sm">
                        Use your recovery code to permanently delete your remote sync data. Your
                        local data will not be deleted.
                    </p>
                    <div class="space-y-1">
                        <Label>24-char Recovery Code</Label>
                        <Input
                            bind:value={recoveryCode}
                            type="text"
                            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                        />
                    </div>
                    <Button
                        variant="destructive"
                        class="w-full"
                        disabled={loading}
                        onclick={handleRecoverDelete}
                    >
                        Delete Remote Account
                    </Button>
                    <div class="text-center pt-2">
                        <Button
                            variant="link"
                            class="text-xs text-muted-foreground"
                            onclick={() => (mode = 'recover')}
                        >
                            Cancel
                        </Button>
                    </div>
                </div>
            {:else if mode === 'pair_new'}
                <div class="space-y-3">
                    <div class="space-y-1">
                        <Label>8-char Pairing Code</Label>
                        <Input bind:value={pairingCodeInput} type="text" placeholder="XXXXXXXX" />
                    </div>
                    <Button class="w-full" disabled={loading} onclick={handlePairNewDevice}>
                        <Link class="mr-2 size-4" /> Pair Device
                    </Button>
                </div>
            {/if}
        {:else}
            <!-- LOGGED IN STATE -->
            <div class="flex border-b mb-2">
                <button
                    class="px-4 py-2 font-medium text-sm border-b-2 {mode === 'change_password'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground'}"
                    onclick={() => (mode = 'change_password')}>Settings</button
                >
                <button
                    class="px-4 py-2 font-medium text-sm border-b-2 {mode === 'unlink'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground'}"
                    onclick={() => (mode = 'unlink')}>Unlink</button
                >
                <button
                    class="px-4 py-2 font-medium text-sm border-b-2 {mode === 'pair_existing'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground'}"
                    onclick={() => {
                        mode = 'pair_existing';
                        generatedPairingCode = '';
                    }}>Pair New Device</button
                >
            </div>

            {#if mode === 'unlink'}
                <div class="space-y-3 p-4 border border-destructive/30 bg-destructive/5 rounded-lg">
                    <h3 class="font-bold flex items-center gap-2 text-destructive">
                        <AlertTriangle class="size-4" /> Danger Zone
                    </h3>
                    <p class="text-sm">
                        Disconnecting stops sync on this device. Your local account and data remain
                        available.
                    </p>
                    <Button
                        variant="destructive"
                        class="w-full"
                        disabled={loading}
                        onclick={handleUnlink}
                    >
                        Disconnect Sync
                    </Button>
                </div>
            {:else if mode === 'pair_existing'}
                <div class="space-y-3">
                    <p class="text-sm text-muted-foreground">
                        Generate a temporary pairing code to securely link another device without
                        entering your password.
                    </p>
                    <Button class="w-full" disabled={loading} onclick={handleGeneratePairing}>
                        Generate Pairing Code
                    </Button>

                    {#if generatedPairingCode}
                        <div class="mt-4 p-4 border rounded-lg bg-secondary/20 text-center">
                            <Label>Enter this code on the new device:</Label>
                            <div class="mt-2 text-2xl font-mono tracking-widest font-bold">
                                {generatedPairingCode}
                            </div>
                            <p class="text-xs text-muted-foreground mt-2">Expires in 5 minutes.</p>
                        </div>
                    {/if}
                </div>
            {:else}
                <div class="space-y-3">
                    <div class="space-y-1">
                        <Label>Current Password</Label>
                        <Input bind:value={password} type="password" />
                    </div>
                    <div class="space-y-1">
                        <Label>New Password</Label>
                        <Input bind:value={newPassword} type="password" />
                    </div>
                    <Button
                        variant="outline"
                        class="w-full"
                        disabled={loading}
                        onclick={handleChangePassword}
                    >
                        Change Password
                    </Button>
                </div>
                <div class="border-t my-4"></div>
                <Button
                    variant="secondary"
                    class="w-full"
                    disabled={loading}
                    onclick={handleLogout}
                >
                    <LogOut class="mr-2 size-4" /> Local Log Out
                </Button>
            {/if}
        {/if}
    </CardContent>
</Card>
