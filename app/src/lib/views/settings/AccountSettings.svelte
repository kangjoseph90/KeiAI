<script lang="ts">
    import {
        isLoggedIn,
        userEmail,
        username as activeUsername,
        performCreateAccount,
        performSignIn,
        performRecoverAndReset,
        performDeleteWithRecoveryCode,
        performChangePassword,
        performLogout,
        performPairWithCode
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
    import {
        AlertTriangle,
        Key,
        Link,
        LogIn,
        LogOut,
        QrCode,
        ShieldAlert,
        UserPlus
    } from 'lucide-svelte';
    import { getErrorMessage } from '$lib/types/errors';
    import { appConfirm } from '$lib/ui';

    type AuthView = 'signup' | 'login';
    type LoginMethod = 'password' | 'recovery' | 'pairing' | 'delete_remote';
    type AccountView = 'security' | 'devices';

    let email = $state('');
    let username = $state('');
    let password = $state('');
    let confirmPassword = $state('');
    let recoveryCode = $state('');
    let newPassword = $state('');
    let pairingCodeInput = $state('');
    let generatedPairingCode = $state('');
    let loading = $state(false);
    let errorMsg = $state('');
    let successMsg = $state('');
    let displayRecovery = $state('');

    let authView = $state<AuthView>('signup');
    let loginMethod = $state<LoginMethod>('password');
    let accountView = $state<AccountView>('security');

    async function runAction(
        action: () => Promise<void | string | null>,
        successText: string,
        confirm?: () => Promise<boolean>
    ) {
        if (loading) return;
        loading = true;
        errorMsg = '';
        successMsg = '';
        displayRecovery = '';
        try {
            if (confirm && !(await confirm())) return;
            const result = await action();
            if (typeof result === 'string') displayRecovery = result;
            successMsg = successText;
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

    function handleCreateAccount() {
        if (password !== confirmPassword) {
            errorMsg = 'Passwords do not match.';
            return;
        }
        void runAction(
            () => performCreateAccount(username, password, email || undefined),
            'Account created. Save your recovery code.'
        );
    }

    function handlePasswordLogin() {
        void runAction(() => performSignIn(username, password), 'Signed in successfully.');
    }

    function handleRecover() {
        if (newPassword !== confirmPassword) {
            errorMsg = 'Passwords do not match.';
            return;
        }
        void runAction(
            () => performRecoverAndReset(recoveryCode, newPassword),
            'Device recovered. Save your new recovery code.'
        );
    }

    function handlePairNewDevice() {
        void runAction(() => performPairWithCode(pairingCodeInput), 'Device paired successfully.');
    }

    function handleRecoverDelete() {
        void runAction(
            () => performDeleteWithRecoveryCode(recoveryCode),
            'Remote account deleted. Local data remains available.',
            () =>
                appConfirm({
                    title: 'Delete remote account?',
                    description:
                        'This permanently deletes the encrypted remote account. Local data on this device remains available.',
                    confirmText: 'Delete',
                    variant: 'destructive'
                })
        );
    }

    function handleChangePassword() {
        void runAction(
            () => performChangePassword(password, newPassword),
            'Password changed. Save your new recovery code.'
        );
    }

    function handleLogout() {
        void runAction(() => performLogout(), 'Signed out on this device.');
    }

    async function handleGeneratePairing() {
        if (loading) return;
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
</script>

<Card>
    <CardHeader>
        <CardTitle>Account & Sync</CardTitle>
        <CardDescription>
            {#if $isLoggedIn}
                Signed in{#if $activeUsername}: <strong>@{$activeUsername}</strong>{/if}
            {:else}
                Not signed in
            {/if}
        </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-5" aria-busy={loading}>
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
                    If you lose this code, this device may be the only place that can recover your
                    data.
                </p>
                <div
                    class="bg-amber-100 dark:bg-amber-950/50 p-3 rounded font-mono text-center tracking-widest text-xl font-bold border border-amber-200 dark:border-amber-900 select-all"
                >
                    {displayRecovery}
                </div>
            </div>
        {/if}

        {#if !$isLoggedIn}
            <section class="space-y-4">
                <div class="grid grid-cols-2 rounded-md border p-1">
                    <button
                        class="rounded px-3 py-2 text-sm font-medium {authView === 'signup'
                            ? 'bg-secondary text-foreground'
                            : 'text-muted-foreground'}"
                        onclick={() => (authView = 'signup')}
                    >
                        Sign Up
                    </button>
                    <button
                        class="rounded px-3 py-2 text-sm font-medium {authView === 'login'
                            ? 'bg-secondary text-foreground'
                            : 'text-muted-foreground'}"
                        onclick={() => (authView = 'login')}
                    >
                        Log In
                    </button>
                </div>

                {#if authView === 'signup'}
                    <div class="space-y-3">
                        <div class="grid gap-3 sm:grid-cols-2">
                            <div class="space-y-1">
                                <Label>Username</Label>
                                <Input
                                    bind:value={username}
                                    type="text"
                                    placeholder="your-name"
                                    disabled={loading}
                                />
                            </div>
                            <div class="space-y-1">
                                <Label>Email (optional)</Label>
                                <Input
                                    bind:value={email}
                                    type="email"
                                    placeholder="updates@example.com"
                                    disabled={loading}
                                />
                            </div>
                        </div>
                        <div class="grid gap-3 sm:grid-cols-2">
                            <div class="space-y-1">
                                <Label>Password</Label>
                                <Input
                                    bind:value={password}
                                    type="password"
                                    placeholder="Password"
                                    disabled={loading}
                                />
                            </div>
                            <div class="space-y-1">
                                <Label>Confirm Password</Label>
                                <Input
                                    bind:value={confirmPassword}
                                    type="password"
                                    placeholder="Confirm password"
                                    disabled={loading}
                                />
                            </div>
                        </div>
                        <Button class="w-full" disabled={loading} onclick={handleCreateAccount}>
                            <UserPlus class="mr-2 size-4" /> Create Account
                        </Button>
                    </div>
                {:else}
                    <div class="flex flex-wrap gap-2">
                        <Button
                            variant={loginMethod === 'password' ? 'secondary' : 'outline'}
                            size="sm"
                            onclick={() => (loginMethod = 'password')}
                        >
                            <LogIn class="mr-2 size-4" /> Username
                        </Button>
                        <Button
                            variant={loginMethod === 'recovery' ? 'secondary' : 'outline'}
                            size="sm"
                            onclick={() => (loginMethod = 'recovery')}
                        >
                            <Key class="mr-2 size-4" /> Recovery Code
                        </Button>
                        <Button
                            variant={loginMethod === 'pairing' ? 'secondary' : 'outline'}
                            size="sm"
                            onclick={() => (loginMethod = 'pairing')}
                        >
                            <QrCode class="mr-2 size-4" /> Pairing Code
                        </Button>
                    </div>

                    {#if loginMethod === 'password'}
                        <div class="space-y-3">
                            <div class="space-y-1">
                                <Label>Username</Label>
                                <Input
                                    bind:value={username}
                                    type="text"
                                    placeholder="your-name"
                                    disabled={loading}
                                />
                            </div>
                            <div class="space-y-1">
                                <Label>Password</Label>
                                <Input
                                    bind:value={password}
                                    type="password"
                                    placeholder="Password"
                                    disabled={loading}
                                />
                            </div>
                            <Button class="w-full" disabled={loading} onclick={handlePasswordLogin}>
                                <Link class="mr-2 size-4" /> Log In
                            </Button>
                        </div>
                    {:else if loginMethod === 'recovery'}
                        <div class="space-y-3">
                            <div class="space-y-1">
                                <Label>Recovery Code</Label>
                                <Input
                                    bind:value={recoveryCode}
                                    type="text"
                                    placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                                    disabled={loading}
                                />
                            </div>
                            <div class="grid gap-3 sm:grid-cols-2">
                                <div class="space-y-1">
                                    <Label>New Password</Label>
                                    <Input
                                        bind:value={newPassword}
                                        type="password"
                                        placeholder="New password"
                                        disabled={loading}
                                    />
                                </div>
                                <div class="space-y-1">
                                    <Label>Confirm Password</Label>
                                    <Input
                                        bind:value={confirmPassword}
                                        type="password"
                                        placeholder="Confirm password"
                                        disabled={loading}
                                    />
                                </div>
                            </div>
                            <Button class="w-full" disabled={loading} onclick={handleRecover}>
                                <Key class="mr-2 size-4" /> Recover Account
                            </Button>
                            <Button
                                variant="ghost"
                                class="w-full text-destructive hover:text-destructive"
                                disabled={loading}
                                onclick={() => (loginMethod = 'delete_remote')}
                            >
                                Delete remote account instead
                            </Button>
                        </div>
                    {:else if loginMethod === 'pairing'}
                        <div class="space-y-3">
                            <div class="space-y-1">
                                <Label>Pairing Code</Label>
                                <Input
                                    bind:value={pairingCodeInput}
                                    type="text"
                                    placeholder="XXXXXXXX"
                                    disabled={loading}
                                />
                            </div>
                            <Button class="w-full" disabled={loading} onclick={handlePairNewDevice}>
                                <QrCode class="mr-2 size-4" /> Pair Device
                            </Button>
                        </div>
                    {:else}
                        <div
                            class="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-4"
                        >
                            <h3 class="font-bold flex items-center gap-2 text-destructive">
                                <AlertTriangle class="size-4" /> Delete Remote Account
                            </h3>
                            <div class="space-y-1">
                                <Label>Recovery Code</Label>
                                <Input
                                    bind:value={recoveryCode}
                                    type="text"
                                    placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                                    disabled={loading}
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
                            <Button
                                variant="ghost"
                                class="w-full"
                                disabled={loading}
                                onclick={() => (loginMethod = 'recovery')}
                            >
                                Cancel
                            </Button>
                        </div>
                    {/if}
                {/if}
            </section>
        {:else}
            <section class="space-y-4">
                <div class="rounded-md border p-3 text-sm">
                    <div class="font-medium">
                        {$activeUsername ? `@${$activeUsername}` : 'Connected account'}
                    </div>
                    {#if $userEmail}
                        <div class="text-muted-foreground">{$userEmail}</div>
                    {/if}
                </div>

                <div class="flex flex-wrap gap-2">
                    <Button
                        variant={accountView === 'security' ? 'secondary' : 'outline'}
                        size="sm"
                        onclick={() => (accountView = 'security')}
                    >
                        Security
                    </Button>
                    <Button
                        variant={accountView === 'devices' ? 'secondary' : 'outline'}
                        size="sm"
                        onclick={() => {
                            accountView = 'devices';
                            generatedPairingCode = '';
                        }}
                    >
                        Pair Device
                    </Button>
                </div>

                {#if accountView === 'security'}
                    <div class="space-y-3">
                        <div class="space-y-1">
                            <Label>Current Password</Label>
                            <Input bind:value={password} type="password" disabled={loading} />
                        </div>
                        <div class="space-y-1">
                            <Label>New Password</Label>
                            <Input bind:value={newPassword} type="password" disabled={loading} />
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
                {:else if accountView === 'devices'}
                    <div class="space-y-3">
                        <Button class="w-full" disabled={loading} onclick={handleGeneratePairing}>
                            Generate Pairing Code
                        </Button>
                        {#if generatedPairingCode}
                            <div class="rounded-md border bg-secondary/20 p-4 text-center">
                                <Label>Pairing Code</Label>
                                <div class="mt-2 text-2xl font-mono tracking-widest font-bold">
                                    {generatedPairingCode}
                                </div>
                            </div>
                        {/if}
                    </div>
                {/if}

                <div class="border-t pt-4">
                    <Button
                        variant="secondary"
                        class="w-full"
                        disabled={loading}
                        onclick={handleLogout}
                    >
                        <LogOut class="mr-2 size-4" /> Sign Out
                    </Button>
                </div>
            </section>
        {/if}
    </CardContent>
</Card>
