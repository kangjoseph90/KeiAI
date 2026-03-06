<script lang="ts">
	import { MessageSquare, Pencil, Plus, Trash2, Check, X } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Card, CardContent } from '$lib/components/ui/card/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import {
		chats,
		activeCharacter,
		characterLorebooks,
		characterScripts,
		createChat,
		updateChat,
		deleteChat,
		createCharacterLorebook,
		deleteCharacterLorebook,
		createCharacterScript,
		deleteCharacterScript
	} from '$lib/stores';
	import type { RouteState } from '$lib/router';

	let { charId, onNavigate }: { charId: string; onNavigate: (r: RouteState) => void } = $props();

	let newNameInput = $state('');
	let editModeId = $state<string | null>(null);
	let editNameInput = $state('');

	async function handleCreateChat() {
		if (!newNameInput.trim()) return;
		const chat = await createChat(charId, { title: newNameInput, lastMessagePreview: '' });
		newNameInput = '';
		onNavigate({ view: 'chat', charId, chatId: chat.id });
	}

	async function handleUpdateChat(id: string) {
		if (!editNameInput.trim()) return;
		await updateChat(id, { title: editNameInput });
		editModeId = null;
	}

	async function handleCreateLorebook() {
		if (!newNameInput.trim()) return;
		await createCharacterLorebook(charId, {
			name: newNameInput,
			keys: [],
			content: '',
			insertionDepth: 0,
			enabled: true
		});
		newNameInput = '';
	}

	async function handleCreateScript() {
		if (!newNameInput.trim()) return;
		await createCharacterScript(charId, {
			name: newNameInput,
			regex: '',
			replacement: '',
			placement: 'input',
			enabled: true
		});
		newNameInput = '';
	}
</script>

<div class="flex gap-6">
	<!-- Chats List -->
	<div class="flex flex-col gap-3" style="flex: 2">
		<h3 class="font-semibold">Chats</h3>
		<div class="flex gap-2">
			<Input bind:value={newNameInput} placeholder="New Chat Title" class="flex-1" />
			<Button class="gap-1.5" onclick={handleCreateChat}
				><MessageSquare class="size-4" /> Start Chat</Button
			>
		</div>

		<div class="flex flex-col gap-2">
			{#each $chats as chat (chat.id)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<Card
					class="cursor-pointer transition-colors hover:bg-accent"
					onclick={() => onNavigate({ view: 'chat', charId, chatId: chat.id })}
				>
					<CardContent class="p-4">
						{#if editModeId === chat.id}
							<div class="flex gap-2" onclick={(e) => e.stopPropagation()}>
								<Input bind:value={editNameInput} class="flex-1" />
								<Button size="sm" class="gap-1.5" onclick={() => handleUpdateChat(chat.id)}
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
									<MessageSquare class="size-4 shrink-0 text-muted-foreground" />
									<div>
										<p class="font-medium">{chat.title}</p>
										<p class="text-xs text-muted-foreground">
											{chat.lastMessagePreview || 'No messages yet...'}
										</p>
									</div>
								</div>
								<div class="flex gap-1">
									<Button
										size="sm"
										variant="outline"
										onclick={(e) => {
											e.stopPropagation();
											editModeId = chat.id;
											editNameInput = chat.title;
										}}><Pencil class="size-4" /></Button
									>
									<Button
										size="sm"
										variant="destructive"
										onclick={(e) => {
											e.stopPropagation();
											deleteChat(chat.id, charId);
										}}><Trash2 class="size-4" /></Button
									>
								</div>
							</div>
						{/if}
					</CardContent>
				</Card>
			{:else}
				<p class="text-sm text-muted-foreground">No chats for this character yet.</p>
			{/each}
		</div>
	</div>

	<!-- Character-Owned Items -->
	<div class="flex flex-1 flex-col gap-3 border-l pl-6">
		<h3 class="font-semibold">Char Lorebooks</h3>
		<div class="flex gap-2">
			<Input bind:value={newNameInput} placeholder="Name" class="flex-1" />
			<Button class="gap-1.5" onclick={handleCreateLorebook}><Plus class="size-4" /> Add</Button>
		</div>
		<div class="flex flex-col gap-1">
			{#each $characterLorebooks as lb (lb.id)}
				<div class="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
					<span>{lb.name}</span>
					<Button
						size="sm"
						variant="ghost"
						onclick={() => deleteCharacterLorebook(charId, lb.id)}
					><Trash2 class="size-3" /></Button>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">None yet.</p>
			{/each}
		</div>

		<Separator class="my-2" />

		<h3 class="font-semibold">Char Scripts</h3>
		<div class="flex flex-col gap-1">
			{#each $characterScripts as sc (sc.id)}
				<div class="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
					<span>{sc.name}</span>
					<Button
						size="sm"
						variant="ghost"
						onclick={() => deleteCharacterScript(charId, sc.id)}
					><Trash2 class="size-3" /></Button>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">None yet.</p>
			{/each}
		</div>
	</div>
</div>
