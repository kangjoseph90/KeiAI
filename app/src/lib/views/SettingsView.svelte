<script lang="ts">
	import { RefreshCw } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import { appSettings, updateSettings } from '$lib/stores';
	import AccountSettings from './AccountSettings.svelte';

	async function handleToggleTheme() {
		const currentTheme = $appSettings?.theme === 'dark' ? 'light' : 'dark';
		await updateSettings({ theme: currentTheme });
	}
</script>

<div class="grid gap-6 max-w-2xl">
	<AccountSettings />

	<Card>
		<CardHeader>
			<CardTitle>App Settings</CardTitle>
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			<pre class="rounded-md bg-muted p-4 text-xs overflow-x-auto">{JSON.stringify(
					$appSettings,
					null,
					2
				)}</pre>
			<Button variant="outline" class="gap-1.5" onclick={handleToggleTheme}
				><RefreshCw class="size-4" /> Toggle Theme Setting</Button
			>
		</CardContent>
	</Card>
</div>
