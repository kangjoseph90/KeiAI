<script lang="ts">
	import { ChevronRight, Pencil, Plus, Trash2, Check, X } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Card, CardContent } from '$lib/components/ui/card/index.js';
	import {
		characters,
		createCharacter,
		updateCharacterSummary,
		deleteCharacter
	} from '$lib/stores';
	import type { RouteState } from '$lib/router';

	let { onNavigate }: { onNavigate: (r: RouteState) => void } = $props();

	let newNameInput = $state('');
	let editModeId = $state<string | null>(null);
	let editNameInput = $state('');

	async function handleCreate() {
		if (!newNameInput.trim()) return;
		await createCharacter({ name: newNameInput, shortDescription: 'An offline-first character' });
		newNameInput = '';
	}

	async function handleUpdate(id: string) {
		if (!editNameInput.trim()) return;
		await updateCharacterSummary(id, { name: editNameInput });
		editModeId = null;
	}

	function startEdit(id: string, name: string) {
		editModeId = id;
		editNameInput = name;
	}
</script>

<div class="flex flex-col gap-4">
	<div class="flex gap-2">
		<Input bind:value={newNameInput} placeholder="New Character Name" class="flex-1" />
		<Button class="gap-1.5" onclick={handleCreate}><Plus class="size-4" /> Create</Button>
	</div>

	<div class="flex flex-col gap-2">
		{#each $characters as char (char.id)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<Card
				class="cursor-pointer transition-colors hover:bg-accent"
				onclick={() => onNavigate({ view: 'chats', charId: char.id })}
			>
				<CardContent class="p-4">
					{#if editModeId === char.id}
						<div class="flex gap-2" onclick={(e) => e.stopPropagation()}>
							<Input bind:value={editNameInput} class="flex-1" />
							<Button size="sm" class="gap-1.5" onclick={() => handleUpdate(char.id)}
								><Check class="size-4" /> Save</Button
							>
							<Button
								size="sm"
								variant="outline"
								class="gap-1.5"
								onclick={() => (editModeId = null)}><X class="size-4" /> Cancel</Button
							>
						</div>
					{:else}
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2">
								<ChevronRight class="size-4 text-muted-foreground" />
								<div>
									<p class="font-medium">{char.name}</p>
									<p class="text-sm text-muted-foreground">{char.shortDescription}</p>
								</div>
							</div>
							<div class="flex gap-1">
								<Button
									size="sm"
									variant="outline"
									onclick={(e) => {
										e.stopPropagation();
										startEdit(char.id, char.name);
									}}><Pencil class="size-4" /></Button
								>
								<Button
									size="sm"
									variant="destructive"
									onclick={(e) => {
										e.stopPropagation();
										deleteCharacter(char.id);
									}}><Trash2 class="size-4" /></Button
								>
							</div>
						</div>
					{/if}
				</CardContent>
			</Card>
		{:else}
			<p class="text-sm text-muted-foreground">No characters created yet.</p>
		{/each}
	</div>
</div>
