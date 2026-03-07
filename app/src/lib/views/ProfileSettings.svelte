<script lang="ts">
	import { activeUser } from '$lib/stores';
	import { updateProfile } from '$lib/stores/user/profile';
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

	let profileName = $state('');
	let profileAvatar = $state('');
	let fileInputRef: HTMLInputElement;

	let loading = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');

	$effect(() => {
		if ($activeUser && !profileName) {
			profileName = $activeUser.name;
		}
	});

	function handleAvatarUpload(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		// Maximum size 5MB
		if (file.size > 5 * 1024 * 1024) {
			errorMsg = 'Avatar image must be under 5MB';
			return;
		}

		errorMsg = '';
		const reader = new FileReader();
		reader.onload = (e) => {
			if (typeof e.target?.result === 'string') {
				profileAvatar = e.target.result;
			}
		};
		reader.readAsDataURL(file);
	}

	async function handleUpdateProfile() {
		loading = true;
		errorMsg = '';
		successMsg = '';

		try {
			await updateProfile({
				name: profileName,
				...(profileAvatar ? { avatar: profileAvatar } : {})
			});
			successMsg = 'Profile updated successfully.';
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e);
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
						src={profileAvatar || $activeUser?.avatar}
						alt={profileName}
						class="object-cover"
					/>
					<Avatar.Fallback class="text-xl font-bold"
						>{(profileName || 'U').charAt(0).toUpperCase()}</Avatar.Fallback
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
				<Input bind:value={profileName} placeholder="Your display name" />
			</div>
		</div>

		<Button class="w-full" disabled={loading || !profileName} onclick={handleUpdateProfile}>
			<UserRoundPen class="mr-2 size-4" /> Save Profile
		</Button>
	</CardContent>
</Card>
