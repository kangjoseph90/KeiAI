<script lang="ts">
	import { Plus, SendHorizontal, Square, Trash2 } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import Message from '$lib/components/Message.svelte';
	import {
		activeChat,
		chatLorebooks,
		displayMessages,
		isGenerating,
		createMessage,
		updateMessage,
		deleteMessage,
		createChatLorebook,
		deleteChatLorebook
	} from '$lib/stores';
	import { runChat, stop, dismiss } from '$lib/generation';
	import { MockStreamProvider } from '$lib/llm/mock';

	let { chatId }: { chatId: string } = $props();

	let newMessageText = $state('');
	let editModeId = $state<string | null>(null);
	let editMessageText = $state('');
	let newLorebookName = $state('');

	async function handleSendMessage() {
		if (!newMessageText.trim() || !$activeChat || $isGenerating) return;
		const userText = newMessageText;
		newMessageText = '';
		await createMessage(chatId, { role: 'user', content: userText });
		const provider = new MockStreamProvider(userText);
		runChat(chatId, provider);
	}

	async function handleUpdateMessage(id: string) {
		if (!editMessageText.trim()) return;
		await updateMessage(id, { content: editMessageText });
		editModeId = null;
	}

	async function handleAddLorebook() {
		if (!newLorebookName.trim()) return;
		await createChatLorebook(chatId, {
			name: newLorebookName,
			keys: [],
			content: '',
			insertionDepth: 0,
			enabled: true
		});
		newLorebookName = '';
	}
</script>

<div class="flex gap-6 h-full">
	<!-- Message Area -->
	<div class="flex flex-col rounded-lg border bg-card h-[calc(100vh-130px)]" style="flex: 2">
		<ScrollArea class="flex-1 p-4">
			<div class="flex flex-col gap-4">
				{#each $displayMessages as msg (msg.id)}
					<Message
						message={msg}
						isEditing={editModeId === msg.id}
						bind:editText={editMessageText}
						onEdit={() => {
							editModeId = msg.id;
							editMessageText = msg.content;
						}}
						onSave={() => handleUpdateMessage(msg.id)}
						onDelete={() => deleteMessage(chatId, msg.id)}
						onCancelEdit={() => (editModeId = null)}
						onDismissError={() => dismiss(chatId)}
					/>
				{/each}
			</div>
		</ScrollArea>

		<!-- Message Input -->
		<div class="flex gap-2 border-t p-3">
			<Input
				bind:value={newMessageText}
				onkeydown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
				placeholder="Type an encrypted message..."
				class="flex-1"
				disabled={$isGenerating}
			/>
			{#if $isGenerating}
				<Button variant="destructive" class="gap-1.5" onclick={() => stop(chatId)}>
					<Square class="size-4" /> Stop
				</Button>
			{:else}
				<Button class="gap-1.5" onclick={handleSendMessage}>
					<SendHorizontal class="size-4" /> Send
				</Button>
			{/if}
		</div>
	</div>

	<!-- Chat Lorebooks -->
	<div class="flex flex-1 flex-col gap-3 border-l pl-6">
		<h3 class="font-semibold">Chat Lorebooks</h3>
		<div class="flex gap-2">
			<Input bind:value={newLorebookName} placeholder="Name" class="flex-1" />
			<Button class="gap-1.5" onclick={handleAddLorebook}><Plus class="size-4" /> Add</Button>
		</div>
		<div class="flex flex-col gap-1">
			{#each $chatLorebooks as lb (lb.id)}
				<div class="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
					<span>{lb.name}</span>
					<Button size="sm" variant="ghost" onclick={() => deleteChatLorebook(chatId, lb.id)}
						><Trash2 class="size-3" /></Button
					>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">None yet.</p>
			{/each}
		</div>
	</div>
</div>
