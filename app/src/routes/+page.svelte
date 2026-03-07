<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { UserService, AuthService } from '$lib/services';
	import { SyncManager } from '$lib/services/sync';
	import { BookText, Layers, Plug, Settings, User, Users } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Avatar from '$lib/components/ui/avatar';
	import {
		loadGlobalState,
		loadProfile,
		selectCharacter,
		selectChat,
		clearActiveCharacter,
		activeCharacter,
		activeChat,
		activeUser,
		userEmail
	} from '$lib/stores';
	import {
		route,
		navigate,
		initHashListener,
		getCurrentHashRoute,
		type RouteState,
		type ViewMode
	} from '$lib/router';
	import type { ComponentType } from 'svelte';
	import { getErrorMessage } from '$lib/shared/errors';

	import CharactersView from '$lib/views/CharactersView.svelte';
	import ChatsView from '$lib/views/ChatsView.svelte';
	import ChatView from '$lib/views/ChatView.svelte';
	import PersonasView from '$lib/views/PersonasView.svelte';
	import PresetsView from '$lib/views/PresetsView.svelte';
	import ModulesView from '$lib/views/ModulesView.svelte';
	import PluginsView from '$lib/views/PluginsView.svelte';
	import SettingsView from '$lib/views/SettingsView.svelte';
	import ManageAccountsDialog from '$lib/views/ManageAccountsDialog.svelte';

	let ready = $state(false);
	let errorMsg = $state('');
	let manageAccountsOpen = $state(false);

	const sidebarItems: { view: ViewMode; label: string; icon: ComponentType }[] = [
		{ view: 'characters', label: 'Characters', icon: Users },
		{ view: 'personas', label: 'Personas', icon: User },
		{ view: 'presets', label: 'Presets', icon: BookText },
		{ view: 'modules', label: 'Modules', icon: Layers },
		{ view: 'plugins', label: 'Plugins', icon: Plug },
		{ view: 'settings', label: 'Settings', icon: Settings }
	];

	// 현재 route에서 헤더 타이틀 계산
	function getTitle(r: RouteState): string {
		switch (r.view) {
			case 'characters':
				return 'Characters';
			case 'chats':
				return $activeCharacter ? `${$activeCharacter.name}'s Chats` : 'Chats';
			case 'chat':
				return $activeChat ? `Chat: ${$activeChat.title}` : 'Chat';
			case 'personas':
				return 'Personas';
			case 'presets':
				return 'Prompt Presets';
			case 'modules':
				return 'Modules';
			case 'plugins':
				return 'Plugins';
			case 'settings':
				return 'Global App Settings';
		}
	}

	function getBackTarget(r: RouteState): RouteState | null {
		if (r.view === 'chat' && r.charId) return { view: 'chats', charId: r.charId };
		if (r.view === 'chats') return { view: 'characters' };
		return null;
	}

	// URL 복원 시 소유권 검증 포함
	async function restoreRoute(initial: RouteState): Promise<void> {
		try {
			if (initial.view === 'chats' && initial.charId) {
				await selectCharacter(initial.charId);
				navigate(initial);
			} else if (initial.view === 'chat' && initial.charId && initial.chatId) {
				await selectCharacter(initial.charId);
				await selectChat(initial.chatId, initial.charId);
				navigate(initial);
			} else {
				navigate(initial);
			}
		} catch (e) {
			// 복호화 실패 or 소유권 불일치 → 홈으로
			console.warn('Route restore failed, falling back to characters:', e);
			clearActiveCharacter();
			navigate({ view: 'characters' });
		}
	}

	// navigate 시 store 상태 동기화
	async function handleNavigate(next: RouteState): Promise<void> {
		try {
			if (next.view === 'characters') {
				clearActiveCharacter();
			} else if (next.view === 'chats' && next.charId) {
				if ($activeCharacter?.id !== next.charId) {
					await selectCharacter(next.charId);
				}
			} else if (next.view === 'chat' && next.charId && next.chatId) {
				if ($activeCharacter?.id !== next.charId) {
					await selectCharacter(next.charId);
				}
				if ($activeChat?.id !== next.chatId) {
					await selectChat(next.chatId, next.charId);
				}
			} else if (!['personas', 'presets', 'modules', 'plugins', 'settings'].includes(next.view)) {
				clearActiveCharacter();
			}
		} catch (e) {
			console.error('Navigation failed:', e);
			navigate({ view: 'characters' });
			return;
		}
		navigate(next);
	}

	let _cleanupHash: (() => void) | undefined;

	onMount(async () => {
		try {
			const wasRestored = await UserService.restoreOrCreateGuest();
			// If the local DB was cleared (storage eviction, first install), PB may
			// still hold a stale JWT. Clear it so sync starts from a clean state.
			if (!wasRestored) {
				AuthService.clearAuth();
			}
			await loadProfile();
			SyncManager.startAutoSync({ onProfileUpdate: loadProfile });
			await SyncManager.syncAll();
			await loadGlobalState();
			ready = true;

			const initialRoute = getCurrentHashRoute();
			await restoreRoute(initialRoute);

			_cleanupHash = initHashListener();
		} catch (err) {
			errorMsg = getErrorMessage(err);
		}
	});

	onDestroy(() => {
		SyncManager.stopAutoSync();
		_cleanupHash?.();
	});

	// route store 변화를 감지해 store 동기화 (뒤로가기/앞으로가기 처리)
	let prevRoute: RouteState | null = null;
	$effect(() => {
		const r = $route;
		if (!ready || !prevRoute) {
			prevRoute = r;
			return;
		}
		// 같은 route면 무시
		if (
			prevRoute.view === r.view &&
			prevRoute.charId === r.charId &&
			prevRoute.chatId === r.chatId
		) {
			prevRoute = r;
			return;
		}
		prevRoute = r;
		handleNavigate(r);
	});
</script>

<main class="flex h-screen bg-background text-foreground overflow-hidden">
	{#if errorMsg}
		<div
			class="absolute inset-x-0 top-0 z-50 bg-destructive px-4 py-2 text-center text-sm font-medium text-white"
		>
			{errorMsg}
		</div>
	{/if}

	{#if !ready}
		<div class="flex flex-1 items-center justify-center">
			<p class="text-muted-foreground text-sm">Initializing Secure Local Session...</p>
		</div>
	{:else}
		<!-- Sidebar Navigation -->
		<nav class="flex w-48 shrink-0 flex-col gap-1 border-r p-4 justify-between">
			<div class="flex flex-col gap-1">
				<p class="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					Menu
				</p>
				{#each sidebarItems as item (item.view)}
					{@const isActive =
						$route.view === item.view ||
						(item.view === 'characters' && ($route.view === 'chats' || $route.view === 'chat'))}
					<Button
						variant={isActive ? 'default' : 'ghost'}
						class="justify-start gap-2"
						onclick={() => handleNavigate({ view: item.view as ViewMode })}
					>
						<item.icon class="size-4" />
						{item.label}
					</Button>
				{/each}
			</div>

			<div class="mt-auto">
				<DropdownMenu.Root>
					<DropdownMenu.Trigger class="w-full">
						<div
							class="flex items-center gap-2 p-2 hover:bg-muted/50 rounded-md transition-colors text-left cursor-pointer"
						>
							<Avatar.Root class="size-8">
								<Avatar.Image src={$activeUser?.avatar} alt={$activeUser?.name ?? 'User'} />
								<Avatar.Fallback
									>{($activeUser?.name ?? 'U').charAt(0).toUpperCase()}</Avatar.Fallback
								>
							</Avatar.Root>
							<div class="flex flex-col overflow-hidden">
								<span class="text-sm font-medium truncate">{$activeUser?.name ?? 'Guest User'}</span
								>
								<span class="text-xs text-muted-foreground truncate"
									>{$userEmail ?? 'Offline / Local'}</span
								>
							</div>
						</div>
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start" class="w-48">
						<DropdownMenu.Label>My Account</DropdownMenu.Label>
						<DropdownMenu.Separator />
						<DropdownMenu.Item onclick={() => (manageAccountsOpen = true)}>
							<Users class="mr-2 size-4" />
							<span>Manage Profiles</span>
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => handleNavigate({ view: 'settings' })}>
							<Settings class="mr-2 size-4" />
							<span>App Settings</span>
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		</nav>

		<!-- Main Content Area -->
		<div class="flex flex-1 flex-col overflow-hidden">
			<!-- Header -->
			<div class="flex shrink-0 items-center justify-between border-b px-6 py-4">
				<h2 class="text-lg font-semibold">{getTitle($route)}</h2>
				{#if getBackTarget($route)}
					{@const back = getBackTarget($route)!}
					<Button variant="outline" size="sm" class="gap-1.5" onclick={() => handleNavigate(back)}>
						← Back
					</Button>
				{/if}
			</div>

			<!-- View Content -->
			<div class="flex-1 overflow-y-auto p-6">
				{#if $route.view === 'characters'}
					<CharactersView onNavigate={handleNavigate} />
				{:else if $route.view === 'chats' && $route.charId}
					<ChatsView charId={$route.charId} onNavigate={handleNavigate} />
				{:else if $route.view === 'chat' && $route.chatId}
					<ChatView chatId={$route.chatId} />
				{:else if $route.view === 'personas'}
					<PersonasView />
				{:else if $route.view === 'presets'}
					<PresetsView />
				{:else if $route.view === 'modules'}
					<ModulesView />
				{:else if $route.view === 'plugins'}
					<PluginsView />
				{:else if $route.view === 'settings'}
					<SettingsView />
				{/if}
			</div>
		</div>

		<ManageAccountsDialog bind:open={manageAccountsOpen} />
	{/if}
</main>
