<script lang="ts">
	import { onMount } from 'svelte';
	import { initSession } from '$lib/session';
	import {
		characters, loadGlobalState, createCharacter, selectCharacter,
		activeCharacter, activeChats, clearActiveCharacter,
		createChat, selectChat, activeChat, messages, clearActiveChat,
		sendMessage
	} from '$lib/stores';

	let ready = false;
	let errorMsg = '';

	// Navigation State
	let view: 'characters' | 'chats' | 'chat' = 'characters';

	// Form Inputs
	let newCharName = '';
	let newChatTitle = '';
	let newMessageText = '';

	onMount(async () => {
		try {
			await initSession();
			await loadGlobalState();
			ready = true;
		} catch (err: any) {
			errorMsg = err.message;
		}
	});

	// --- Character Level ---
	async function handleCreateCharacter() {
		if (!newCharName.trim()) return;
		await createCharacter(
			newCharName,
			'An offline-first character',
			'You are a highly capable AI running via E2EE datastore.'
		);
		newCharName = '';
	}

	async function handleSelectCharacter(charId: string) {
		await selectCharacter(charId);
		view = 'chats';
	}

	// --- Chat Level ---
	async function handleCreateChat() {
		if (!newChatTitle.trim() || !$activeCharacter) return;
		await createChat(newChatTitle);
		newChatTitle = '';
	}

	async function handleSelectChat(chatId: string) {
		await selectChat(chatId);
		view = 'chat';
	}

	// --- Message Level ---
	async function handleSendMessage() {
		if (!newMessageText.trim() || !$activeChat) return;
		const userText = newMessageText;
		newMessageText = '';

		// User writes
		await sendMessage('user', userText);

		// Bot replies (mock)
		setTimeout(async () => {
			if (!$activeChat) return;
			await sendMessage('char', `[E2EE Bot] Received securely: "${userText}"`);
		}, 600);
	}

	// --- Navigation ---
	function handleGoBack() {
		if (view === 'chat') {
			view = 'chats';
			clearActiveChat();
		} else if (view === 'chats') {
			view = 'characters';
			clearActiveCharacter();
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
					{$activeCharacter?.name}'s Chats
				{:else if view === 'chat'}
					Chat: {$activeChat?.title}
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
				{#each $characters as char}
					<div
						style="padding: 15px; background: #f4f4f4; border-radius: 8px; cursor: pointer; border: 1px solid transparent;"
						on:click={() => handleSelectCharacter(char.id)}
						on:keydown={(e) => e.key === 'Enter' && handleSelectCharacter(char.id)}
						role="button"
						tabindex="0"
					>
						<h3 style="margin: 0 0 5px 0;">{char.name}</h3>
						<p style="margin: 0; font-size: 0.9em; color: #555;">{char.shortDescription}</p>
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
				{#each $activeChats as chat}
					<div
						style="padding: 15px; background: #eef7ff; border-radius: 8px; cursor: pointer;"
						on:click={() => handleSelectChat(chat.id)}
						on:keydown={(e) => e.key === 'Enter' && handleSelectChat(chat.id)}
						role="button"
						tabindex="0"
					>
						<h4 style="margin: 0 0 5px 0;">{chat.title}</h4>
						<p style="margin: 0; font-size: 0.85em; color: #666;">
							{chat.lastMessagePreview || 'No messages yet...'}
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
					{#each $messages as msg}
						<div
							style="align-self: {msg.role === 'user' ? 'flex-end' : 'flex-start'};
									background: {msg.role === 'user' ? '#007BFF' : '#E9ECEF'};
									color: {msg.role === 'user' ? '#FFF' : '#000'};
									padding: 8px 14px; border-radius: 12px; max-width: 80%;"
						>
							{msg.content}
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
