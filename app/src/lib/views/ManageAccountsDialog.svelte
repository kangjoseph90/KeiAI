<script lang="ts">
	import { appUser, type UserRecord } from '$lib/adapters/user';
	import { activeUser } from '$lib/stores';
	import { performCreateNewGuest } from '$lib/stores/user/auth';
	import { UserService } from '$lib/services/user/user';

	import * as Dialog from '$lib/components/ui/dialog';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Avatar from '$lib/components/ui/avatar';
	import { Button } from '$lib/components/ui/button';
	import { UserPlus, Check, Trash2 } from 'lucide-svelte';

	let { open = $bindable(false) } = $props();

	let users = $state<UserRecord[]>([]);
	let userToDelete = $state<UserRecord | null>(null);
	let loading = $state(false);

	async function loadUsers() {
		const allUsers = await appUser.getAllUsers();

		users = allUsers.sort((a, b) => {
			// Always put the active user at the absolute top
			if ($activeUser?.id === a.id) return -1;
			if ($activeUser?.id === b.id) return 1;

			// Otherwise sort by most recently updated
			return b.updatedAt - a.updatedAt;
		});
	}

	$effect(() => {
		if (open) {
			loadUsers();
		}
	});

	async function switchUser(userId: string) {
		loading = true;
		try {
			await UserService.switchUser(userId);
		} finally {
			loading = false;
		}
	}

	async function handleCreateNewGuest() {
		loading = true;
		try {
			await performCreateNewGuest();
		} catch (e) {
			console.error(e);
			loading = false;
		}
	}

	async function handleDeleteUser() {
		if (!userToDelete) return;
		loading = true;
		try {
			await UserService.deleteUser(userToDelete.id);
			userToDelete = null;
			await loadUsers();
		} finally {
			loading = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md max-h-[85vh] flex flex-col">
		<Dialog.Header>
			<Dialog.Title>Manage Local Accounts</Dialog.Title>
			<Dialog.Description>
				Switch between or delete offline profiles on this device.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex-1 overflow-y-auto flex flex-col gap-3 py-4 pr-1">
			{#each users as u (u.id)}
				{@const isActive = $activeUser?.id === u.id}
				<div
					class="flex flex-shrink-0 items-center justify-between rounded-lg border p-3 {isActive
						? 'border-primary bg-primary/5'
						: ''}"
				>
					<div class="flex items-center gap-3 overflow-hidden">
						<Avatar.Root class="size-10">
							<Avatar.Image src={u.avatar} alt={u.name} class="object-cover" />
							<Avatar.Fallback>{(u.name || 'U').charAt(0).toUpperCase()}</Avatar.Fallback>
						</Avatar.Root>
						<div class="flex flex-col overflow-hidden leading-tight">
							<span class="text-sm font-medium truncate flex items-center gap-2">
								{u.name}
								{#if isActive}
									<span
										class="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full font-bold"
										>ACTIVE</span
									>
								{/if}
							</span>
							<span class="text-xs text-muted-foreground truncate"
								>{u.email || (u.isGuest ? 'Offline Guest' : 'Synced')}</span
							>
						</div>
					</div>

					<div class="flex items-center gap-1.5 shrink-0 pl-2">
						{#if !isActive}
							<Button
								variant="secondary"
								size="sm"
								onclick={() => switchUser(u.id)}
								disabled={loading}
							>
								Switch
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="text-destructive hover:bg-destructive/15 hover:text-destructive size-8"
								onclick={() => (userToDelete = u)}
								disabled={loading}
							>
								<Trash2 class="size-4" />
							</Button>
						{:else}
							<Button variant="outline" size="sm" disabled class="opacity-50">
								<Check class="size-4 mr-1.5" /> Current
							</Button>
						{/if}
					</div>
				</div>
			{/each}

			<Button
				variant="outline"
				class="w-full mt-2 border-dashed h-12 shrink-0 text-muted-foreground hover:text-foreground"
				onclick={handleCreateNewGuest}
				disabled={loading}
			>
				<UserPlus class="mr-2 size-4" /> Create New Guest Area
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root
	open={userToDelete !== null}
	onOpenChange={(o) => {
		if (!o) userToDelete = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete account?</AlertDialog.Title>
			<AlertDialog.Description>
				Are you sure you want to delete <strong>{userToDelete?.name}</strong> from this device?
				{#if userToDelete?.isGuest}
					<div
						class="mt-4 p-3 bg-destructive/10 text-destructive border border-destructive/20 rounded-md font-medium text-sm"
					>
						This is a local guest account. All local messages, characters, and settings for this
						profile will be permanently destroyed.
					</div>
				{:else}
					<div class="mt-4 p-3 bg-muted text-muted-foreground rounded-md text-sm">
						This will only remove the account from this device. Your server data remains intact and
						can be restored by logging in again.
					</div>
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={loading}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
				onclick={handleDeleteUser}
				disabled={loading}
			>
				Yes, Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
