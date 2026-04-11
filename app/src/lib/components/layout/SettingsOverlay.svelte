<script lang="ts">
	/**
	 * SettingsOverlay — RisuAI-style full-screen settings overlay.
	 * Left sidebar menu + right content area.
	 * Reuses existing view components (PersonasView, PresetsView, etc.)
	 */
	import { X } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { Separator } from '$lib/components/ui/separator';

	let {
		open = $bindable(false),
		onClose
	}: {
		open?: boolean;
		onClose: () => void;
	} = $props();

	type SettingsCategory =
		| 'profile'
		| 'account'
		| 'chatbot'
		| 'persona'
		| 'presets'
		| 'modules'
		| 'plugins'
		| 'display';

	const categories: { id: SettingsCategory; label: string }[] = [
		{ id: 'profile', label: 'Profile' },
		{ id: 'account', label: 'Account' },
		{ id: 'chatbot', label: 'Chat Bot' },
		{ id: 'persona', label: 'Persona' },
		{ id: 'presets', label: 'Presets' },
		{ id: 'modules', label: 'Modules' },
		{ id: 'plugins', label: 'Plugins' },
		{ id: 'display', label: 'Display' }
	];

	let activeTab = $state<SettingsCategory>('profile');

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- Backdrop -->
	<div class="fixed inset-0 z-50 bg-black/50" onclick={onClose} role="presentation"></div>

	<!-- Settings Panel -->
	<div
		class="fixed inset-0 z-50 flex animate-in fade-in duration-200"
		onclick={(e) => {
			if (e.target === e.currentTarget) onClose();
		}}
		role="dialog"
		aria-label="Settings"
	>
		<div
			class="mx-auto my-auto flex h-[85vh] w-[90vw] max-w-5xl overflow-hidden rounded-xl border bg-background shadow-2xl"
		>
			<!-- Left: Category Menu -->
			<nav class="flex w-52 shrink-0 flex-col border-r bg-muted/30">
				<div class="flex items-center justify-between border-b px-4 py-3">
					<h2 class="text-sm font-semibold">Settings</h2>
					<Button variant="ghost" size="sm" class="h-7 w-7 p-0" onclick={onClose}>
						<X class="size-4" />
					</Button>
				</div>
				<div class="flex flex-col gap-0.5 p-2">
					{#each categories as cat (cat.id)}
						<button
							class="rounded-md px-3 py-2 text-left text-sm transition-colors {activeTab === cat.id
								? 'bg-accent text-accent-foreground font-medium'
								: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
							onclick={() => (activeTab = cat.id)}
						>
							{cat.label}
						</button>
					{/each}
				</div>
			</nav>

			<!-- Right: Content -->
			<div class="flex-1 overflow-y-auto">
				<div class="p-6">
					{#if activeTab === 'profile'}
						{#await import('$lib/views/ProfileSettings.svelte') then m}
							<m.default />
						{/await}
					{:else if activeTab === 'account'}
						{#await import('$lib/views/AccountSettings.svelte') then m}
							<m.default />
						{/await}
					{:else if activeTab === 'chatbot'}
						{#await import('$lib/views/settings/ChatBotSettings.svelte') then m}
							<m.default />
						{/await}
					{:else if activeTab === 'persona'}
						{#await import('$lib/views/PersonasView.svelte') then m}
							<m.default />
						{/await}
					{:else if activeTab === 'presets'}
						{#await import('$lib/views/PresetsView.svelte') then m}
							<m.default />
						{/await}
					{:else if activeTab === 'modules'}
						{#await import('$lib/views/ModulesView.svelte') then m}
							<m.default />
						{/await}
					{:else if activeTab === 'plugins'}
						{#await import('$lib/views/PluginsView.svelte') then m}
							<m.default />
						{/await}
					{:else if activeTab === 'display'}
						{#await import('$lib/views/settings/DisplaySettings.svelte') then m}
							<m.default />
						{/await}
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}
