<script lang="ts">
	import { Plus, Trash2, X } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Separator } from '$lib/components/ui/separator';
	import { Badge } from '$lib/components/ui/badge';
	import {
		presets,
		appSettings,
		activePreset,
		createPreset,
		selectPreset,
		updatePresetSummary,
		updatePresetData,
		deletePreset,
		getPresetDetail
	} from '$lib/stores';
	import type { ModelConfig } from '$lib/types/models';

	// ── List State ─────────────────────────────────────────────────
	let newNameInput = $state('');

	// ── Editor State ───────────────────────────────────────────────
	let editingId = $state<string | null>(null);
	let editName = $state('');
	let editDescription = $state('');
	let editChatModel = $state<ModelConfig>({ id: '', provider: 'openai', parameters: {} });
	let editMaxResponse = $state(600);
	let editMaxContext = $state(4096);

	const selectedPresetId = $derived($appSettings?.presetId);

	async function handleCreate() {
		if (!newNameInput.trim()) return;
		const detail = await createPreset({ name: newNameInput, description: '' });
		newNameInput = '';
		await openEditor(detail.id);
	}

	async function openEditor(id: string) {
		const detail = await getPresetDetail(id);
		editingId = id;
		editName = detail.name;
		editDescription = detail.description;
		editChatModel = { ...detail.data.chatModel };
		editMaxResponse = detail.data.maxResponse;
		editMaxContext = detail.data.maxContext;
	}

	function closeEditor() {
		editingId = null;
	}

	function handleSummaryChange() {
		if (!editingId) return;
		updatePresetSummary(editingId, { name: editName, description: editDescription });
	}

	function handleDataChange() {
		if (!editingId) return;
		updatePresetData(editingId, {
			chatModel: editChatModel,
			maxResponse: editMaxResponse,
			maxContext: editMaxContext
		});
	}

	async function handleSelect(id: string) {
		await selectPreset(id);
	}

	async function handleDelete(id: string) {
		if (editingId === id) closeEditor();
		await deletePreset(id);
	}
</script>

<div class="flex gap-6 max-w-5xl">
	<!-- Left: Preset List -->
	<div class="flex flex-col gap-3 w-72 shrink-0">
		<div class="flex gap-2">
			<Input bind:value={newNameInput} placeholder="New Preset Name" class="flex-1" />
			<Button size="sm" class="gap-1.5" onclick={handleCreate}><Plus class="size-4" /></Button>
		</div>

		<div class="flex flex-col gap-2">
			{#each $presets as preset (preset.id)}
				<Card class={selectedPresetId === preset.id ? 'border-primary' : ''}>
					<CardContent class="p-3">
						<div class="flex items-center justify-between gap-2">
							<button class="flex-1 text-left" onclick={() => openEditor(preset.id)}>
								<p class="font-medium text-sm truncate">{preset.name || 'Unnamed'}</p>
								{#if preset.description}
									<p class="text-xs text-muted-foreground truncate">{preset.description}</p>
								{/if}
							</button>
							<div class="flex items-center gap-1 shrink-0">
								{#if selectedPresetId === preset.id}
									<Badge variant="default" class="text-xs">Active</Badge>
								{:else}
									<Button
										size="sm"
										variant="outline"
										class="text-xs h-6 px-2"
										onclick={() => handleSelect(preset.id)}>Use</Button
									>
								{/if}
								<Button
									size="sm"
									variant="ghost"
									class="h-6 w-6 p-0"
									onclick={() => handleDelete(preset.id)}
								>
									<Trash2 class="size-3" />
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>
			{:else}
				<p class="text-sm text-muted-foreground">No presets yet. Create one to get started.</p>
			{/each}
		</div>
	</div>

	<!-- Right: Preset Editor -->
	<div class="flex-1 min-w-0">
		{#if editingId}
			<Card>
				<CardHeader>
					<CardTitle class="flex items-center justify-between">
						<span>Edit Preset</span>
						<Button size="sm" variant="ghost" onclick={closeEditor}><X class="size-4" /></Button>
					</CardTitle>
				</CardHeader>
				<CardContent class="flex flex-col gap-4">
					<!-- Summary -->
					<div class="grid grid-cols-2 gap-4">
						<div class="flex flex-col gap-1.5">
							<Label for="preset-name">Name</Label>
							<Input id="preset-name" bind:value={editName} oninput={handleSummaryChange} />
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="preset-desc">Description</Label>
							<Input
								id="preset-desc"
								bind:value={editDescription}
								oninput={handleSummaryChange}
								placeholder="Optional"
							/>
						</div>
					</div>

					<Separator />

					<!-- Model -->
					<div class="flex flex-col gap-1.5">
						<Label for="preset-model">Chat Model ID</Label>
						<Input
							id="preset-model"
							value={editChatModel.id}
							oninput={(e) => { editChatModel = { ...editChatModel, id: e.currentTarget.value }; handleDataChange(); }}
							placeholder="openai::gpt-5.4, custom::xxxxx, etc."
							class="font-mono text-sm"
						/>
						<p class="text-xs text-muted-foreground">
							Select a model from built-in or custom models. Full model selector UI coming soon.
						</p>
					</div>

					<Separator />

					<!-- Token Limits -->
					<div class="grid grid-cols-2 gap-4">
						<div class="flex flex-col gap-1.5">
							<Label for="preset-maxresp">Max Response Tokens</Label>
							<Input
								id="preset-maxresp"
								type="number"
								bind:value={editMaxResponse}
								oninput={handleDataChange}
								min={1}
							/>
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="preset-maxctx">Max Context Tokens</Label>
							<Input
								id="preset-maxctx"
								type="number"
								bind:value={editMaxContext}
								oninput={handleDataChange}
								min={1}
							/>
						</div>
					</div>

					<Separator />

					<!-- Actions -->
					<div class="flex items-center gap-3">
						{#if selectedPresetId !== editingId}
							<Button variant="outline" onclick={() => handleSelect(editingId!)}
								>Use this Preset</Button
							>
						{:else}
							<Badge variant="default">Currently Active</Badge>
						{/if}
					</div>
				</CardContent>
			</Card>
		{:else}
			<Card>
				<CardContent class="p-8 text-center text-muted-foreground">
					<p>Select a preset from the list to edit, or create a new one.</p>
					{#if !selectedPresetId}
						<p class="mt-2 text-xs">
							⚠️ No preset is active. Create and select one to enable AI chat.
						</p>
					{/if}
				</CardContent>
			</Card>
		{/if}
	</div>
</div>
