<script lang="ts">
	import { isLoggedIn, isGuest, userEmail } from '$lib/stores/auth.js';
	import { AuthService } from '$lib/core/api/auth.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Key, LogIn, LogOut, UserPlus, ShieldAlert, AlertTriangle } from 'lucide-svelte';

	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let newPassword = $state('');
	let recoveryCode = $state('');
	
	let loading = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');
	let displayRecovery = $state('');

	let mode = $state<'login' | 'register' | 'recover' | 'change_password' | 'unlink'>('login');

	// Auto-reset mode when auth state changes (e.g. after login, logout, unlink)
	$effect(() => {
		if (!$isLoggedIn) {
			if (!['login', 'register', 'recover'].includes(mode)) mode = 'login';
		} else {
			if (!['change_password', 'unlink'].includes(mode)) mode = 'change_password';
		}
	});

	async function runAction(action: () => Promise<void | string>, successText: string) {
		loading = true;
		errorMsg = '';
		successMsg = '';
		displayRecovery = '';
		try {
			const result = await action();
			if (typeof result === 'string') displayRecovery = result;
			successMsg = successText;
			email = '';
			password = '';
			confirmPassword = '';
			newPassword = '';
			recoveryCode = '';
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function handleLogin() {
		runAction(() => AuthService.login(email, password), 'Logged in successfully.');
	}

	function handleRegister() {
		if (password !== confirmPassword) {
			errorMsg = 'Passwords do not match.';
			return;
		}
		runAction(() => AuthService.register(email, password), 'Account registered.');
	}

	function handleRecover() {
		runAction(() => AuthService.recoverPassword(email, recoveryCode, newPassword), 'Password recovered.');
	}

	function handleChangePassword() {
		runAction(() => AuthService.changePassword(password, newPassword), 'Password changed. Save your new recovery code.');
	}

	function handleUnlink() {
		runAction(() => AuthService.unlinkAccount(password), 'Account unlinked. Reverted to guest mode.');
	}

	function handleLogout() {
		runAction(() => AuthService.logout(), 'Logged out successfully.');
	}
</script>

<Card>
	<CardHeader>
		<CardTitle>Account & Synchronization</CardTitle>
		<CardDescription>
			{#if !$isLoggedIn}
				{#if $isGuest}
					You are currently using an offline guest account.
				{:else}
					You are using an offline session. Data is not syncing.
				{/if}
			{:else}
				Logged in as: <strong>{$userEmail}</strong>
			{/if}
		</CardDescription>
	</CardHeader>
	<CardContent class="flex flex-col gap-4">
		{#if errorMsg}
			<div class="rounded-md bg-destructive/15 p-3 text-sm text-destructive border border-destructive/20 font-medium">
				{errorMsg}
			</div>
		{/if}
		
		{#if successMsg}
			<div class="rounded-md bg-green-500/15 p-3 text-sm text-green-600 dark:text-green-400 border border-green-500/20 font-medium">
				{successMsg}
			</div>
		{/if}

		{#if displayRecovery}
			<div class="rounded-md bg-amber-500/15 p-4 text-sm text-amber-700 dark:text-amber-400 border border-amber-500/20">
				<div class="flex items-center gap-2 font-bold mb-2">
					<ShieldAlert class="size-5" />
					SAVE YOUR RECOVERY CODE NOW
				</div>
				<p class="mb-2">If you forget your password, this is the ONLY way to recover your account data. Write it down and keep it safe.</p>
				<div class="bg-amber-100 dark:bg-amber-950/50 p-3 rounded font-mono text-center tracking-widest text-xl font-bold border border-amber-200 dark:border-amber-900 select-all">
					{displayRecovery}
				</div>
			</div>
		{/if}

		{#if !$isLoggedIn}
			<!-- GUEST STATE -->
			<div class="flex border-b mb-2">
				<button class="px-4 py-2 font-medium text-sm border-b-2 {mode === 'login' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}" onclick={() => mode = 'login'}>Login</button>
				{#if $isGuest}
					<button class="px-4 py-2 font-medium text-sm border-b-2 {mode === 'register' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}" onclick={() => mode = 'register'}>Register / Link</button>
				{/if}
				<button class="px-4 py-2 font-medium text-sm border-b-2 {mode === 'recover' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}" onclick={() => mode = 'recover'}>Recover</button>
			</div>
			
			{#if mode === 'login' || mode === 'register'}
				<div class="space-y-3">
					{#if !$isGuest && mode === 'login'}
						<div class="mb-2 p-3 text-sm rounded bg-primary/10 text-primary border border-primary/20">
							You are in Offline Mode. Log in to resume synchronization.
						</div>
					{/if}
					<div class="space-y-1">
						<Label>Email</Label>
						<Input bind:value={email} type="email" placeholder="you@example.com" />
					</div>
					<div class="space-y-1">
						<Label>Password</Label>
						<Input bind:value={password} type="password" placeholder="••••••••" />
					</div>
					{#if mode === 'register'}
						<div class="space-y-1">
							<Label>Confirm Password</Label>
							<Input bind:value={confirmPassword} type="password" placeholder="••••••••" />
						</div>
					{/if}
					{#if mode === 'login'}
						<Button class="w-full" disabled={loading} onclick={handleLogin}>
							<LogIn class="mr-2 size-4" /> Log In
						</Button>
					{:else}
						<Button class="w-full" disabled={loading} onclick={handleRegister}>
							<UserPlus class="mr-2 size-4" /> Link Account & Setup Sync
						</Button>
						<p class="text-xs text-muted-foreground mt-2">
							This will securely back up your single-device guest data and encrypt it with your new password.
						</p>
					{/if}
				</div>
			{:else if mode === 'recover'}
				<div class="space-y-3">
					<div class="space-y-1">
						<Label>Email</Label>
						<Input bind:value={email} type="email" placeholder="you@example.com" />
					</div>
					<div class="space-y-1">
						<Label>16-char Recovery Code</Label>
						<Input bind:value={recoveryCode} type="text" placeholder="16 characters recovery code" />
					</div>
					<div class="space-y-1">
						<Label>New Password</Label>
						<Input bind:value={newPassword} type="password" placeholder="••••••••" />
					</div>
					<Button class="w-full" disabled={loading} onclick={handleRecover}>
						<Key class="mr-2 size-4" /> Recover Account
					</Button>
				</div>
			{/if}

		{:else}
			<!-- LOGGED IN STATE -->
			<div class="flex border-b mb-2">
				<button class="px-4 py-2 font-medium text-sm border-b-2 {mode === 'change_password' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}" onclick={() => mode = 'change_password'}>Settings</button>
				<button class="px-4 py-2 font-medium text-sm border-b-2 {mode === 'unlink' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}" onclick={() => mode = 'unlink'}>Unlink</button>
			</div>

			{#if mode === 'unlink'}
				<div class="space-y-3 p-4 border border-destructive/30 bg-destructive/5 rounded-lg">
					<h3 class="font-bold flex items-center gap-2 text-destructive"><AlertTriangle class="size-4" /> Danger Zone</h3>
					<p class="text-sm">Unlinking will permanently delete your account from the server. Your data will remain locally on this device as a Guest account.</p>
					<div class="space-y-1">
						<Label>Confirm Password</Label>
						<Input bind:value={password} type="password" />
					</div>
					<Button variant="destructive" class="w-full" disabled={loading} onclick={handleUnlink}>
						Unlink & Revert to Guest
					</Button>
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
					<Button variant="outline" class="w-full" disabled={loading} onclick={handleChangePassword}>
						Change Password
					</Button>
				</div>
				<div class="border-t my-4"></div>
				<Button variant="secondary" class="w-full" disabled={loading} onclick={handleLogout}>
					<LogOut class="mr-2 size-4" /> Local Log Out
				</Button>
			{/if}
		{/if}
	</CardContent>
</Card>
