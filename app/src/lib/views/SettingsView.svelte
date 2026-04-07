<script lang="ts">
	import { Eye, EyeOff, RefreshCw } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { appSettings, updateSettings } from '$lib/stores';
	import AccountSettings from './AccountSettings.svelte';
	import ProfileSettings from './ProfileSettings.svelte';

	let openaiKey = $state('');
	let anthropicKey = $state('');
	let showOpenai = $state(false);
	let showAnthropic = $state(false);

	// Sync from store on mount
	$effect(() => {
		if ($appSettings) {
			openaiKey = $appSettings.openai?.apiKey ?? '';
			anthropicKey = $appSettings.anthropic?.apiKey ?? '';
		}
	});

	function handleKeyChange() {
		updateSettings({
			openai: { apiKey: openaiKey.trim() },
			anthropic: { apiKey: anthropicKey.trim() }
		});
	}

	async function handleToggleTheme() {
		const currentTheme = $appSettings?.theme === 'dark' ? 'light' : 'dark';
		await updateSettings({ theme: currentTheme });
	}
</script>

<div class="grid gap-6 max-w-2xl">
	<ProfileSettings />
	<AccountSettings />

	<!-- API Keys -->
	<Card>
		<CardHeader>
			<CardTitle>API Keys</CardTitle>
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			<div class="flex flex-col gap-1.5">
				<Label for="openai-key">OpenAI API Key</Label>
				<div class="flex gap-2">
					{#if showOpenai}
						<Input
							id="openai-key"
							bind:value={openaiKey}
							oninput={handleKeyChange}
							placeholder="sk-..."
							class="flex-1 font-mono text-sm"
						/>
					{:else}
						<Input
							id="openai-key"
							type="password"
							bind:value={openaiKey}
							oninput={handleKeyChange}
							placeholder="sk-..."
							class="flex-1 font-mono text-sm"
						/>
					{/if}
					<Button size="sm" variant="ghost" onclick={() => (showOpenai = !showOpenai)}>
						{#if showOpenai}<EyeOff class="size-4" />{:else}<Eye class="size-4" />{/if}
					</Button>
				</div>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="anthropic-key">Anthropic API Key</Label>
				<div class="flex gap-2">
					{#if showAnthropic}
						<Input
							id="anthropic-key"
							bind:value={anthropicKey}
							oninput={handleKeyChange}
							placeholder="sk-ant-..."
							class="flex-1 font-mono text-sm"
						/>
					{:else}
						<Input
							id="anthropic-key"
							type="password"
							bind:value={anthropicKey}
							oninput={handleKeyChange}
							placeholder="sk-ant-..."
							class="flex-1 font-mono text-sm"
						/>
					{/if}
					<Button size="sm" variant="ghost" onclick={() => (showAnthropic = !showAnthropic)}>
						{#if showAnthropic}<EyeOff class="size-4" />{:else}<Eye class="size-4" />{/if}
					</Button>
				</div>
			</div>
			<p class="text-xs text-muted-foreground">
				Keys are encrypted with your master key and stored locally. They never leave your device
				unencrypted.
			</p>
		</CardContent>
	</Card>

	<!-- App Settings -->
	<Card>
		<CardHeader>
			<CardTitle>App Settings</CardTitle>
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			<Button variant="outline" class="gap-1.5" onclick={handleToggleTheme}
				><RefreshCw class="size-4" /> Toggle Theme Setting</Button
			>
		</CardContent>
	</Card>
</div>
