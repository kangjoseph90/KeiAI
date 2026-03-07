<script lang="ts">
	import { Check, Pencil, Plus, Trash2, X } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Card, CardContent } from '$lib/components/ui/card';

	type Item = {
		id: string;
		name?: string;
		title?: string;
		shortDescription?: string;
		description?: string;
	};

	let {
		items,
		createPlaceholder,
		onCreate,
		onUpdate,
		onDelete
	}: {
		items: Item[];
		createPlaceholder: string;
		onCreate: (name: string) => Promise<unknown>;
		onUpdate: (id: string, name: string) => Promise<unknown>;
		onDelete: (id: string) => Promise<unknown>;
	} = $props();

	let newNameInput = $state('');
	let editModeId = $state<string | null>(null);
	let editNameInput = $state('');

	async function handleCreate() {
		if (!newNameInput.trim()) return;
		await onCreate(newNameInput);
		newNameInput = '';
	}

	async function handleUpdate(id: string) {
		if (!editNameInput.trim()) return;
		await onUpdate(id, editNameInput);
		editModeId = null;
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex gap-2">
		<Input bind:value={newNameInput} placeholder={createPlaceholder} class="flex-1" />
		<Button class="gap-1.5" onclick={handleCreate}><Plus class="size-4" /> Create</Button>
	</div>

	<div class="flex flex-col gap-2">
		{#each items as item (item.id)}
			<Card>
				<CardContent class="p-4">
					{#if editModeId === item.id}
						<div class="flex gap-2">
							<Input bind:value={editNameInput} class="flex-1" />
							<Button size="sm" class="gap-1.5" onclick={() => handleUpdate(item.id)}
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
							<div>
								<p class="font-medium">{item.name || item.title || 'Unnamed'}</p>
								{#if item.shortDescription || item.description}
									<p class="text-sm text-muted-foreground">
										{item.shortDescription || item.description}
									</p>
								{/if}
							</div>
							<div class="flex gap-1">
								<Button
									size="sm"
									variant="outline"
									onclick={() => {
										editModeId = item.id;
										editNameInput = item.name || item.title || '';
									}}><Pencil class="size-4" /></Button
								>
								<Button size="sm" variant="destructive" onclick={() => onDelete(item.id)}
									><Trash2 class="size-4" /></Button
								>
							</div>
						</div>
					{/if}
				</CardContent>
			</Card>
		{:else}
			<p class="text-sm text-muted-foreground">No items found.</p>
		{/each}
	</div>
</div>
