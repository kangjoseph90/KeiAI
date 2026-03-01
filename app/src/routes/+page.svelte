<script lang="ts">
	import { onMount } from 'svelte';
	import { initSession } from '$lib/session';
	import {
		appSettings,
		loadGlobalState,
		characters,
		createCharacter,
		selectCharacter,
		activeCharacter,
		updateCharacterSummary,
		deleteCharacter,
		clearActiveCharacter,
		chats,
		createChat,
		selectChat,
		activeChat,
		updateChat,
		deleteChat,
		clearActiveChat,
		messages,
		createMessage,
		updateMessage,
		deleteMessage,
		personas,
		createPersona,
		updatePersona,
		deletePersona,
		promptPresets,
		createPreset,
		updatePresetSummary,
		deletePreset,
		modules,
		createModule,
		updateModule,
		deleteModule,
		plugins,
		createPlugin,
		updatePlugin,
		deletePlugin,
		characterLorebooks,
		createCharacterLorebook,
		deleteCharacterLorebook,
		characterScripts,
		createCharacterScript,
		deleteCharacterScript,
		chatLorebooks,
		createChatLorebook,
		deleteChatLorebook
	} from '$lib/stores';
	import { updateSettings } from '$lib/stores/settings';

	let ready = false;
	let errorMsg = '';

	// Navigation State
	type ViewMode = 'characters' | 'chats' | 'chat' | 'personas' | 'presets' | 'modules' | 'plugins' | 'settings';
	let view: ViewMode = 'characters';

	// General Form Inputs
	let newNameInput = '';
	let editModeId: string | null = null;
	let editNameInput = '';

	// Component-Specific Form Inputs
	let newMessageText = '';
	let editMessageText = '';

	onMount(async () => {
		try {
			await initSession();
			await loadGlobalState();
			ready = true;
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : String(err);
		}
	});

	function resetInputs() {
		newNameInput = '';
		editModeId = null;
		editNameInput = '';
		newMessageText = '';
		editMessageText = '';
	}

	function switchView(newView: ViewMode) {
		view = newView;
		resetInputs();
		if (newView !== 'chats' && newView !== 'chat') clearActiveCharacter();
		if (newView !== 'chat') clearActiveChat();
	}

	// --- Generic CRUD Handlers for Simple Entities ---
	async function handleCreate(type: 'persona' | 'preset' | 'module' | 'plugin' | 'characterLorebook' | 'characterScript' | 'chatLorebook') {
		if (!newNameInput.trim()) return;
		try {
			const name = newNameInput;
			newNameInput = '';
			switch (type) {
				case 'persona': await createPersona({ name, description: 'Test Persona' }); break;
				case 'preset': await createPreset({ name, description: 'Test Preset' }); break;
				case 'module': await createModule({ name, description: 'Test Module' }); break;
				case 'plugin': await createPlugin({ name, description: 'Test Plugin', version: '0.0.1', code: '', config: {}, hooks: [] }); break;
				case 'characterLorebook': 
					if ($activeCharacter) await createCharacterLorebook($activeCharacter.id, { name, keys: [], content: 'Test lore details', insertionDepth: 0, enabled: true }); 
					break;
				case 'characterScript': 
					if ($activeCharacter) await createCharacterScript($activeCharacter.id, { name, regex: '', replacement: '', placement: 'onInput', enabled: true }); 
					break;
				case 'chatLorebook': 
					if ($activeChat) await createChatLorebook($activeChat.id, { name, keys: [], content: 'Test chat lore', insertionDepth: 0, enabled: true }); 
					break;
			}
		} catch (e) { console.error(e); }
	}

	async function handleUpdate(type: 'persona' | 'preset' | 'module' | 'plugin', id: string) {
		if (!editNameInput.trim()) return;
		try {
			const name = editNameInput;
			editModeId = null;
			switch (type) {
				case 'persona': await updatePersona(id, { name }); break;
				case 'preset': await updatePresetSummary(id, { name }); break;
				case 'module': await updateModule(id, { name }); break;
				case 'plugin': await updatePlugin(id, { name }); break;
			}
		} catch (e) { console.error(e); }
	}

	async function handleDelete(type: 'persona' | 'preset' | 'module' | 'plugin' | 'characterLorebook' | 'characterScript' | 'chatLorebook', id: string) {
		try {
			switch (type) {
				case 'persona': await deletePersona(id); break;
				case 'preset': await deletePreset(id); break;
				case 'module': await deleteModule(id); break;
				case 'plugin': await deletePlugin(id); break;
				case 'characterLorebook': 
					if ($activeCharacter) await deleteCharacterLorebook($activeCharacter.id, id); 
					break;
				case 'characterScript': 
					if ($activeCharacter) await deleteCharacterScript($activeCharacter.id, id); 
					break;
				case 'chatLorebook': 
					if ($activeChat) await deleteChatLorebook($activeChat.id, id); 
					break;
			}
		} catch (e) { console.error(e); }
	}

	function startEditMode(id: string, currentName: string) {
		editModeId = id;
		editNameInput = currentName;
	}


	// --- Character Level ---
	async function handleCreateCharacter() {
		if (!newNameInput.trim()) return;
		await createCharacter({ name: newNameInput, shortDescription: 'An offline-first character' });
		newNameInput = '';
	}

	async function handleUpdateCharacter(id: string) {
		if (!editNameInput.trim()) return;
		await updateCharacterSummary(id, { name: editNameInput });
		editModeId = null;
	}

	async function handleSelectCharacter(charId: string) {
		await selectCharacter(charId);
		view = 'chats';
		resetInputs();
	}

	// --- Chat Level ---
	async function handleCreateChat() {
		if (!newNameInput.trim() || !$activeCharacter) return;
		await createChat($activeCharacter.id, { title: newNameInput, lastMessagePreview: '' });
		newNameInput = '';
	}

	async function handleUpdateChat(id: string) {
		if (!editNameInput.trim()) return;
		await updateChat(id, { title: editNameInput });
		editModeId = null;
	}

	async function handleDeleteChat(id: string) {
		if ($activeCharacter) await deleteChat(id, $activeCharacter.id);
	}

	async function handleSelectChat(chatId: string) {
		if (!$activeCharacter) return;
		await selectChat(chatId, $activeCharacter.id);
		view = 'chat';
		resetInputs();
	}

	// --- Message Level ---
	async function handleSendMessage() {
		if (!newMessageText.trim() || !$activeChat) return;
		const userText = newMessageText;
		const chatId = $activeChat.id;
		newMessageText = '';

		await createMessage(chatId, { role: 'user', content: userText });
		setTimeout(async () => {
			await createMessage(chatId, { role: 'char', content: `[E2EE Bot] Received securely: "${userText}"` });
		}, 600);
	}

	async function handleUpdateMessage(id: string) {
		if (!editMessageText.trim()) return;
		await updateMessage(id, { content: editMessageText });
		editModeId = null;
	}

	async function handleDeleteMessage(id: string) {
		if ($activeChat) await deleteMessage($activeChat.id, id);
	}

	// --- Settings ---
	async function handleToggleAppDebug() {
		// Just a dummy toggle to test appSettings update
		const currentTheme = $appSettings?.theme === 'dark' ? 'light' : 'dark';
		await updateSettings({ theme: currentTheme });
	}

</script>

<main style="max-width: 800px; margin: 40px auto; font-family: sans-serif; display: flex; gap: 20px;">
	{#if errorMsg}
		<div style="background: red; color: white; padding: 10px; width: 100%; position: absolute; top: 0; left: 0;">{errorMsg}</div>
	{/if}

	{#if !ready}
		<p>Initializing Secure Local Session...</p>
	{:else}
		<!-- Sidebar Navigation -->
		<nav style="width: 150px; display: flex; flex-direction: column; gap: 10px; border-right: 1px solid #ccc; padding-right: 20px;">
			<h3 style="margin-top: 0;">Menu</h3>
			{#each ['characters', 'personas', 'presets', 'modules', 'plugins', 'settings'] as menuView}
				<button 
					on:click={() => switchView(menuView as ViewMode)}
					style="padding: 10px; text-align: left; background: {view === menuView || (menuView === 'characters' && (view === 'chats' || view === 'chat')) ? '#007BFF' : '#f4f4f4'}; color: {view === menuView || (menuView === 'characters' && (view === 'chats' || view === 'chat')) ? 'white' : 'black'}; border: none; border-radius: 4px; cursor: pointer;"
				>
					{menuView.charAt(0).toUpperCase() + menuView.slice(1)}
				</button>
			{/each}
		</nav>

		<!-- Main Content Area -->
		<div style="flex: 1;">
			<!-- Header -->
			<div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #ccc; padding-bottom: 15px; margin-bottom: 20px;">
				<h2 style="margin: 0;">
					{#if view === 'characters'} Characters
					{:else if view === 'chats'} {$activeCharacter?.name}'s Detail & Chats
					{:else if view === 'chat'} Chat: {$activeChat?.title}
					{:else if view === 'personas'} Personas
					{:else if view === 'presets'} Prompt Presets
					{:else if view === 'modules'} Modules
					{:else if view === 'plugins'} Plugins
					{:else if view === 'settings'} Global App Settings
					{/if}
				</h2>
				{#if view === 'chats' || view === 'chat'}
					<button on:click={() => switchView(view === 'chat' ? 'chats' : 'characters')} style="padding: 5px 15px;">⬅ Back</button>
				{/if}
			</div>

			<!-- Entity List Template Maker -->
			{#snippet renderEntityList(items: any[], type: any, handleCrateFn: any, createPlaceholder: string)}
				<div style="display: flex; gap: 10px; margin-bottom: 20px;">
					<input bind:value={newNameInput} placeholder={createPlaceholder} style="flex:1; padding: 8px;" />
					<button on:click={() => handleCrateFn(type)}>Create</button>
				</div>
				<div style="display: flex; flex-direction: column; gap: 10px;">
					{#each items as item (item.id)}
						<div style="padding: 15px; background: #f4f4f4; border-radius: 8px; border: 1px solid #ddd;">
							{#if editModeId === item.id}
								<div style="display: flex; gap: 10px;">
									<input bind:value={editNameInput} style="flex:1; padding: 5px;" />
									<button on:click={() => type === 'character' ? handleUpdateCharacter(item.id) : handleUpdate(type, item.id)}>Save</button>
									<button on:click={() => editModeId = null}>Cancel</button>
								</div>
							{:else}
								<div style="display: flex; justify-content: space-between; align-items: center;">
									<div>
										<h3 style="margin: 0 0 5px 0;">{item.name || item.title || 'Unnamed'}</h3>
										<p style="margin: 0; font-size: 0.9em; color: #555;">{item.shortDescription || item.description || ''}</p>
									</div>
									<div style="display: flex; gap: 5px;">
										<button on:click={(e) => { e.stopPropagation(); startEditMode(item.id, item.name || item.title || ''); }}>Edit</button>
										<button on:click={(e) => { e.stopPropagation(); type === 'character' ? deleteCharacter(item.id) : handleDelete(type, item.id); }} style="background: #ff4444; color: white;">Del</button>
									</div>
								</div>
							{/if}
						</div>
					{:else}
						<p style="color: #888;">No items found.</p>
					{/each}
				</div>
			{/snippet}

			<!-- Render Specific Views -->
			{#if view === 'characters'}
				<div style="display: flex; gap: 10px; margin-bottom: 20px;">
					<input bind:value={newNameInput} placeholder="New Character Name" style="flex:1; padding: 8px;" />
					<button on:click={handleCreateCharacter}>Create</button>
				</div>
				<div style="display: flex; flex-direction: column; gap: 10px;">
					{#each $characters as char (char.id)}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div style="padding: 15px; background: #f4f4f4; border-radius: 8px; border: 1px solid #ddd; cursor: pointer;" on:click={() => handleSelectCharacter(char.id)}>
							{#if editModeId === char.id}
								<div style="display: flex; gap: 10px;" on:click|stopPropagation={()=>{}}>
									<input bind:value={editNameInput} style="flex:1; padding: 5px;" />
									<button on:click={() => handleUpdateCharacter(char.id)}>Save</button>
									<button on:click={() => editModeId = null}>Cancel</button>
								</div>
							{:else}
								<div style="display: flex; justify-content: space-between; align-items: center;">
									<div>
										<h3 style="margin: 0 0 5px 0;">{char.name}</h3>
										<p style="margin: 0; font-size: 0.9em; color: #555;">{char.shortDescription}</p>
									</div>
									<div style="display: flex; gap: 5px;">
										<button on:click={(e) => { e.stopPropagation(); startEditMode(char.id, char.name); }}>Edit</button>
										<button on:click={(e) => { e.stopPropagation(); deleteCharacter(char.id); }} style="background: #ff4444; color: white;">Del</button>
									</div>
								</div>
							{/if}
						</div>
					{:else}
						<p style="color: #888;">No characters created yet.</p>
					{/each}
				</div>

			{:else if view === 'personas'} {@render renderEntityList($personas, 'persona', handleCreate, "New Persona Name")}
			{:else if view === 'presets'}  {@render renderEntityList($promptPresets, 'preset', handleCreate, "New Preset Name")}
			{:else if view === 'modules'}  {@render renderEntityList($modules, 'module', handleCreate, "New Module Name")}
			{:else if view === 'plugins'}  {@render renderEntityList($plugins, 'plugin', handleCreate, "New Plugin Name")}
			
			{:else if view === 'settings'}
				<div style="padding: 15px; background: #f4f4f4; border-radius: 8px; border: 1px solid #ddd;">
					<h3>App Settings</h3>
					<pre style="background: #eee; padding: 10px; overflow-x: auto;">{JSON.stringify($appSettings, null, 2)}</pre>
					<button on:click={handleToggleAppDebug}>Toggle Theme Setting (Test Update)</button>
				</div>

			{:else if view === 'chats'}
				<div style="display: flex; gap: 20px;">
					<!-- Left Col: Chats -->
					<div style="flex: 2;">
						<h3>Chats</h3>
						<div style="display: flex; gap: 10px; margin-bottom: 20px;">
							<input bind:value={newNameInput} placeholder="New Chat Title" style="flex:1; padding: 8px;" />
							<button on:click={handleCreateChat}>Start Chat</button>
						</div>

						<div style="display: flex; flex-direction: column; gap: 10px;">
							{#each $chats as chat (chat.id)}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div style="padding: 15px; background: #eef7ff; border-radius: 8px; cursor: pointer; border: 1px solid #bce8f1;" on:click={() => handleSelectChat(chat.id)}>
									{#if editModeId === chat.id}
										<div style="display: flex; gap: 10px;" on:click|stopPropagation={()=>{}}>
											<input bind:value={editNameInput} style="flex:1; padding: 5px;" />
											<button on:click={() => handleUpdateChat(chat.id)}>Save</button>
											<button on:click={() => editModeId = null}>Cancel</button>
										</div>
									{:else}
										<div style="display: flex; justify-content: space-between; align-items: center;">
											<div>
												<h4 style="margin: 0 0 5px 0;">{chat.title}</h4>
												<p style="margin: 0; font-size: 0.85em; color: #666;">{chat.lastMessagePreview || 'No messages yet...'}</p>
											</div>
											<div style="display: flex; gap: 5px;">
												<button on:click={(e) => { e.stopPropagation(); startEditMode(chat.id, chat.title); }}>Edit</button>
												<button on:click={(e) => { e.stopPropagation(); handleDeleteChat(chat.id); }} style="background: #ff4444; color: white;">Del</button>
											</div>
										</div>
									{/if}
								</div>
							{:else}
								<p style="color: #888;">No chats for this character yet.</p>
							{/each}
						</div>
					</div>

					<!-- Right Col: Character Owned Items -->
					<div style="flex: 1; border-left: 1px solid #eee; padding-left: 20px;">
						<h3>Char Lorebooks</h3>
						{@render renderEntityList($characterLorebooks, 'characterLorebook', handleCreate, "Name")}
						<h3 style="margin-top: 30px;">Char Scripts</h3>
						{@render renderEntityList($characterScripts, 'characterScript', handleCreate, "Name")}
					</div>
				</div>

			{:else if view === 'chat'}
				<div style="display: flex; gap: 20px;">
					<!-- Left Col: Chatting -->
					<div style="flex: 2; background: #fafafa; border: 1px solid #eee; border-radius: 8px; height: 600px; display: flex; flex-direction: column;">
						<!-- Messages Area -->
						<div style="flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 15px;">
							{#each $messages as msg (msg.id)}
								<div style="align-self: {msg.role === 'user' ? 'flex-end' : 'flex-start'}; max-width: 80%; width: 100%;">
									<div style="display: flex; justify-content: {msg.role === 'user' ? 'flex-end' : 'flex-start'}; gap: 5px; margin-bottom: 2px;">
										{#if msg.role === 'user'}
											<button on:click={() => { editModeId = msg.id; editMessageText = msg.content; }} style="font-size: 0.7em; padding: 2px 5px;">Edit</button>
											<button on:click={() => handleDeleteMessage(msg.id)} style="font-size: 0.7em; padding: 2px 5px; background: #ff4444; color: white;">Del</button>
										{/if}
									</div>
									{#if editModeId === msg.id}
										<div style="display: flex; flex-direction: column; gap: 5px;">
											<textarea bind:value={editMessageText} style="width: 100%; min-height: 60px; padding: 8px;"></textarea>
											<div style="display: flex; gap: 5px; justify-content: flex-end;">
												<button on:click={() => handleUpdateMessage(msg.id)}>Save</button>
												<button on:click={() => editModeId = null}>Cancel</button>
											</div>
										</div>
									{:else}
										<div style="background: {msg.role === 'user' ? '#007BFF' : '#E9ECEF'}; color: {msg.role === 'user' ? '#FFF' : '#000'}; padding: 10px 14px; border-radius: 12px; display: inline-block;">
											{msg.content}
										</div>
									{/if}
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
							<button on:click={handleSendMessage} style="border-radius: 20px; padding: 0 20px;">Send</button>
						</div>
					</div>

					<!-- Right Col: Chat Lorebooks -->
					<div style="flex: 1; border-left: 1px solid #eee; padding-left: 20px;">
						<h3>Chat Lorebooks</h3>
						{@render renderEntityList($chatLorebooks, 'chatLorebook', handleCreate, "Name")}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</main>
