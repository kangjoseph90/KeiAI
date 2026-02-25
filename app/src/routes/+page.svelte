<script lang="ts">
	import { onMount } from 'svelte';
	import { initSession, getActiveSession } from '$lib/session';
	import { CharacterService, type Character } from '$lib/services/character';
	import { ChatService, type Chat } from '$lib/services/chat';
	import { MessageService, type Message } from '$lib/services/message';

	let ready = false;
	let errorMsg = '';

	// Navigation State
	let view: 'characters' | 'chats' | 'chat' = 'characters';

	// Data
	let characters: Character[] = [];
	let chats: Chat[] = [];
	let messages: Message[] = [];

	let selectedChar: Character | null = null;
	let selectedChat: Chat | null = null;

	// Form Inputs
	let newCharName = '';
	let newChatTitle = '';
	let newMessageText = '';

	onMount(async () => {
		try {
			await initSession();
			ready = true;
			await loadCharacters();
		} catch (err: any) {
			errorMsg = err.message;
		}
	});

	// --- Character Level ---
	async function loadCharacters() {
		characters = await CharacterService.getAll();
	}

	async function handleCreateCharacter() {
		if (!newCharName.trim()) return;
		await CharacterService.create(
			{ name: newCharName, shortDescription: 'An offline-first character' },
			{ systemPrompt: 'You are a highly capable AI running via E2EE datastore.' }
		);
		newCharName = '';
		await loadCharacters();
	}

	async function handleSelectCharacter(char: Character) {
		selectedChar = char;
		view = 'chats';
		await loadChats();
	}

	// --- Chat Level ---
	async function loadChats() {
		if (!selectedChar) return;
		chats = await ChatService.getByCharacterId(selectedChar.id);
	}

	async function handleCreateChat() {
		if (!newChatTitle.trim() || !selectedChar) return;
		await ChatService.create(selectedChar.id, newChatTitle);
		newChatTitle = '';
		await loadChats();
	}

	async function handleSelectChat(chat: Chat) {
		selectedChat = chat;
		view = 'chat';
		await loadMessages();
	}

	// --- Message Level ---
	async function loadMessages() {
		if (!selectedChat) return;
		messages = await MessageService.getByChatId(selectedChat.id);
	}

	async function handleSendMessage() {
		if (!newMessageText.trim() || !selectedChat) return;
		const userText = newMessageText;
		newMessageText = '';

		// User writes
		await MessageService.create(selectedChat.id, { role: 'user', content: userText });
		await loadMessages();

		// Bot replies (mock)
		setTimeout(async () => {
			if (!selectedChat) return;
			await MessageService.create(selectedChat.id, {
				role: 'char',
				content: `[E2EE Bot] Received securely: "${userText}"`
			});
			await loadMessages();
		}, 600);
	}

	// --- Navigation ---
	function handleGoBack() {
		if (view === 'chat') {
			view = 'chats';
			selectedChat = null;
			loadChats(); // refresh preview text
		} else if (view === 'chats') {
			view = 'characters';
			selectedChar = null;
			loadCharacters();
		}
	}
</script>

<main style="max-width: 600px; margin: 40px auto; font-family: sans-serif;">
	{#if errorMsg}
		<div style="background: red; color: white; padding: 10px;">{errorMsg}</div>
	{/if}

	{#if !ready}
		<p>Initializing Secure Local Session...</p>
	{:else}
		<!-- Header -->
		<div
			style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #ccc; padding-bottom: 15px; margin-bottom: 20px;"
		>
			<h2 style="margin: 0;">
				{#if view === 'characters'}
					Characters
				{:else if view === 'chats'}
					{selectedChar?.summary.name}'s Chats
				{:else if view === 'chat'}
					Chat: {selectedChat?.summary.title}
				{/if}
			</h2>
			{#if view !== 'characters'}
				<button on:click={handleGoBack} style="padding: 5px 15px;">⬅ Back</button>
			{/if}
		</div>

		<!-- View: Characters -->
		{#if view === 'characters'}
			<div style="display: flex; gap: 10px; margin-bottom: 20px;">
				<input
					bind:value={newCharName}
					placeholder="New Character Name"
					style="flex:1; padding: 8px;"
				/>
				<button on:click={handleCreateCharacter}>Create</button>
			</div>

			<div style="display: flex; flex-direction: column; gap: 10px;">
				{#each characters as char}
					<div
						style="padding: 15px; background: #f4f4f4; border-radius: 8px; cursor: pointer; border: 1px solid transparent;"
						on:click={() => handleSelectCharacter(char)}
						on:keydown={(e) => e.key === 'Enter' && handleSelectCharacter(char)}
						role="button"
						tabindex="0"
					>
						<h3 style="margin: 0 0 5px 0;">{char.summary.name}</h3>
						<p style="margin: 0; font-size: 0.9em; color: #555;">{char.summary.shortDescription}</p>
					</div>
				{:else}
					<p style="color: #888;">
						No characters created yet. They will be encrypted in IndexedDB!
					</p>
				{/each}
			</div>

			<!-- View: Chats -->
		{:else if view === 'chats'}
			<div style="display: flex; gap: 10px; margin-bottom: 20px;">
				<input
					bind:value={newChatTitle}
					placeholder="New Chat Title"
					style="flex:1; padding: 8px;"
				/>
				<button on:click={handleCreateChat}>Start Chat</button>
			</div>

			<div style="display: flex; flex-direction: column; gap: 10px;">
				{#each chats as chat}
					<div
						style="padding: 15px; background: #eef7ff; border-radius: 8px; cursor: pointer;"
						on:click={() => handleSelectChat(chat)}
						on:keydown={(e) => e.key === 'Enter' && handleSelectChat(chat)}
						role="button"
						tabindex="0"
					>
						<h4 style="margin: 0 0 5px 0;">{chat.summary.title}</h4>
						<p style="margin: 0; font-size: 0.85em; color: #666;">
							{chat.summary.lastMessagePreview || 'No messages yet...'}
						</p>
					</div>
				{:else}
					<p style="color: #888;">No chats for this character yet.</p>
				{/each}
			</div>

			<!-- View: Chatting -->
		{:else if view === 'chat'}
			<div
				style="background: #fafafa; border: 1px solid #eee; border-radius: 8px; height: 400px; display: flex; flex-direction: column;"
			>
				<!-- Messages Area -->
				<div
					style="flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 10px;"
				>
					{#each messages as msg}
						<div
							style="align-self: {msg.data.role === 'user' ? 'flex-end' : 'flex-start'}; 
									background: {msg.data.role === 'user' ? '#007BFF' : '#E9ECEF'}; 
									color: {msg.data.role === 'user' ? '#FFF' : '#000'}; 
									padding: 8px 14px; border-radius: 12px; max-width: 80%;"
						>
							{msg.data.content}
						</div>
					{/each}
				</div>

				<!-- Input Area -->
				<div style="padding: 10px; border-top: 1px solid #ccc; display: flex; gap: 10px;">
					<input
						bind:value={newMessageText}
						on:keydown={(e) => e.key === 'Enter' && handleSendMessage()}
						placeholder="Type an encrypted message..."
						style="flex: 1; padding: 10px; border-radius: 20px; border: 1px solid #ccc;"
					/>
					<button on:click={handleSendMessage} style="border-radius: 20px; padding: 0 20px;"
						>Send</button
					>
				</div>
			</div>
		{/if}
	{/if}
</main>
