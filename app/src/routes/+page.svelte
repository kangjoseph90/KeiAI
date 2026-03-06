<script lang="ts">
	import { onMount } from 'svelte';
	import { initSession } from '$lib/session';
	import {
		ArrowLeft,
		Check,
		ChevronRight,
		Layers,
		MessageSquare,
		Pencil,
		Plug,
		Plus,
		RefreshCw,
		SendHorizontal,
		Settings,
		Trash2,
		User,
		Users,
		X,
		BookText,
		Square
	} from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
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
		createMessage,
		updateMessage,
		deleteMessage,
		personas,
		createPersona,
		updatePersona,
		deletePersona,
		presets,
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
		deleteChatLorebook,
		displayMessages,
		isGenerating
	} from '$lib/stores';
	import { updateSettings } from '$lib/stores/settings';
	import { runChat, stop, dismiss } from '$lib/generation';
	import { MockStreamProvider } from '$lib/llm/mock';
	import Message from '$lib/components/Message.svelte';

	let ready = false;
	let errorMsg = '';

	const sidebarItems: { view: ViewMode; label: string; icon: any }[] = [
		{ view: 'characters', label: 'Characters', icon: Users },
		{ view: 'personas', label: 'Personas', icon: User },
		{ view: 'presets', label: 'Presets', icon: BookText },
		{ view: 'modules', label: 'Modules', icon: Layers },
		{ view: 'plugins', label: 'Plugins', icon: Plug },
		{ view: 'settings', label: 'Settings', icon: Settings }
	];

	// Navigation State
	type ViewMode =
		| 'characters'
		| 'chats'
		| 'chat'
		| 'personas'
		| 'presets'
		| 'modules'
		| 'plugins'
		| 'settings';
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
	async function handleCreate(
		type:
			| 'persona'
			| 'preset'
			| 'module'
			| 'plugin'
			| 'characterLorebook'
			| 'characterScript'
			| 'chatLorebook'
	) {
		if (!newNameInput.trim()) return;
		try {
			const name = newNameInput;
			newNameInput = '';
			switch (type) {
				case 'persona':
					await createPersona({ name, description: 'Test Persona' });
					break;
				case 'preset':
					await createPreset({ name, description: 'Test Preset' });
					break;
				case 'module':
					await createModule({ name, description: 'Test Module' });
					break;
				case 'plugin':
					await createPlugin({
						name,
						description: 'Test Plugin',
						version: '0.0.1',
						code: '',
						config: {},
						hooks: []
					});
					break;
				case 'characterLorebook':
					if ($activeCharacter)
						await createCharacterLorebook($activeCharacter.id, {
							name,
							keys: [],
							content: 'Test lore details',
							insertionDepth: 0,
							enabled: true
						});
					break;
				case 'characterScript':
					if ($activeCharacter)
						await createCharacterScript($activeCharacter.id, {
							name,
							regex: '',
							replacement: '',
							event: 'pipe:input',
							enabled: true
						});
					break;
				case 'chatLorebook':
					if ($activeChat)
						await createChatLorebook($activeChat.id, {
							name,
							keys: [],
							content: 'Test chat lore',
							insertionDepth: 0,
							enabled: true
						});
					break;
			}
		} catch (e) {
			console.error(e);
		}
	}

	async function handleUpdate(type: 'persona' | 'preset' | 'module' | 'plugin', id: string) {
		if (!editNameInput.trim()) return;
		try {
			const name = editNameInput;
			editModeId = null;
			switch (type) {
				case 'persona':
					await updatePersona(id, { name });
					break;
				case 'preset':
					await updatePresetSummary(id, { name });
					break;
				case 'module':
					await updateModule(id, { name });
					break;
				case 'plugin':
					await updatePlugin(id, { name });
					break;
			}
		} catch (e) {
			console.error(e);
		}
	}

	async function handleDelete(
		type:
			| 'persona'
			| 'preset'
			| 'module'
			| 'plugin'
			| 'characterLorebook'
			| 'characterScript'
			| 'chatLorebook',
		id: string
	) {
		try {
			switch (type) {
				case 'persona':
					await deletePersona(id);
					break;
				case 'preset':
					await deletePreset(id);
					break;
				case 'module':
					await deleteModule(id);
					break;
				case 'plugin':
					await deletePlugin(id);
					break;
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
		} catch (e) {
			console.error(e);
		}
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
		if (!newMessageText.trim() || !$activeChat || $isGenerating) return;
		const userText = newMessageText;
		const chatId = $activeChat.id;
		newMessageText = '';

		// TODO: `pipe:input` eventBus

		// 1. Persist the user message to encrypted DB
		await createMessage(chatId, { role: 'user', content: userText });

		// 2. Kick off AI generation via the Generation Layer (fire-and-forget)
		//    The mock provider simulates word-by-word streaming.
		//    Real providers (OpenAI, Claude) will be drop-in replacements.
		const provider = new MockStreamProvider(userText);
		runChat(chatId, provider);
	}

	function handleStopGeneration() {
		if ($activeChat) stop($activeChat.id);
	}

	function handleDismissError() {
		if ($activeChat) dismiss($activeChat.id);
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

<main class="flex h-screen bg-background text-foreground overflow-hidden">
	{#if errorMsg}
		<div
			class="absolute inset-x-0 top-0 z-50 bg-destructive px-4 py-2 text-center text-sm font-medium text-white"
		>
			{errorMsg}
		</div>
	{/if}

	{#if !ready}
		<div class="flex flex-1 items-center justify-center">
			<p class="text-muted-foreground text-sm">Initializing Secure Local Session...</p>
		</div>
	{:else}
		<!-- Sidebar Navigation -->
		<nav class="flex w-48 shrink-0 flex-col gap-1 border-r p-4">
			<p class="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
				Menu
			</p>
			{#each sidebarItems as item}
				{@const isActive =
					view === item.view ||
					(item.view === 'characters' && (view === 'chats' || view === 'chat'))}
				<Button
					variant={isActive ? 'default' : 'ghost'}
					class="justify-start gap-2"
					onclick={() => switchView(item.view)}
				>
					<item.icon class="size-4" />
					{item.label}
				</Button>
			{/each}
		</nav>

		<!-- Main Content Area -->
		<div class="flex flex-1 flex-col overflow-hidden">
			<!-- Header -->
			<div class="flex shrink-0 items-center justify-between border-b px-6 py-4">
				<h2 class="text-lg font-semibold">
					{#if view === 'characters'}Characters
					{:else if view === 'chats'}{$activeCharacter?.name}'s Chats
					{:else if view === 'chat'}Chat: {$activeChat?.title}
					{:else if view === 'personas'}Personas
					{:else if view === 'presets'}Prompt Presets
					{:else if view === 'modules'}Modules
					{:else if view === 'plugins'}Plugins
					{:else if view === 'settings'}Global App Settings
					{/if}
				</h2>
				{#if view === 'chats' || view === 'chat'}
					<Button
						variant="outline"
						size="sm"
						class="gap-1.5"
						onclick={() => switchView(view === 'chat' ? 'chats' : 'characters')}
					>
						<ArrowLeft class="size-4" /> Back
					</Button>
				{/if}
			</div>

			<!-- Scrollable Content -->
			<div class="flex-1 overflow-y-auto p-6">
				<!-- Entity List Snippet -->
				{#snippet renderEntityList(
					items: any[],
					type: any,
					handleCrateFn: any,
					createPlaceholder: string
				)}
					<div class="mb-4 flex gap-2">
						<Input bind:value={newNameInput} placeholder={createPlaceholder} class="flex-1" />
						<Button class="gap-1.5" onclick={() => handleCrateFn(type)}
							><Plus class="size-4" /> Create</Button
						>
					</div>
					<div class="flex flex-col gap-2">
						{#each items as item (item.id)}
							<Card>
								<CardContent class="p-4">
									{#if editModeId === item.id}
										<div class="flex gap-2">
											<Input bind:value={editNameInput} class="flex-1" />
											<Button
												size="sm"
												class="gap-1.5"
												onclick={() =>
													type === 'character'
														? handleUpdateCharacter(item.id)
														: handleUpdate(type, item.id)}><Check class="size-4" /> Save</Button
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
													onclick={(e) => {
														e.stopPropagation();
														startEditMode(item.id, item.name || item.title || '');
													}}><Pencil class="size-4" /></Button
												>
												<Button
													size="sm"
													variant="destructive"
													onclick={(e) => {
														e.stopPropagation();
														type === 'character'
															? deleteCharacter(item.id)
															: handleDelete(type, item.id);
													}}><Trash2 class="size-4" /></Button
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
				{/snippet}

				<!-- Characters View -->
				{#if view === 'characters'}
					<div class="mb-4 flex gap-2">
						<Input bind:value={newNameInput} placeholder="New Character Name" class="flex-1" />
						<Button class="gap-1.5" onclick={handleCreateCharacter}
							><Plus class="size-4" /> Create</Button
						>
					</div>
					<div class="flex flex-col gap-2">
						{#each $characters as char (char.id)}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<Card
								class="cursor-pointer transition-colors hover:bg-accent"
								onclick={() => handleSelectCharacter(char.id)}
							>
								<CardContent class="p-4">
									{#if editModeId === char.id}
										<div class="flex gap-2" onclick={(e) => e.stopPropagation()}>
											<Input bind:value={editNameInput} class="flex-1" />
											<Button
												size="sm"
												class="gap-1.5"
												onclick={() => handleUpdateCharacter(char.id)}
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
														startEditMode(char.id, char.name);
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

					<!-- Simple Entity Views -->
				{:else if view === 'personas'}
					{@render renderEntityList($personas, 'persona', handleCreate, 'New Persona Name')}
				{:else if view === 'presets'}
					{@render renderEntityList($presets, 'preset', handleCreate, 'New Preset Name')}
				{:else if view === 'modules'}
					{@render renderEntityList($modules, 'module', handleCreate, 'New Module Name')}
				{:else if view === 'plugins'}
					{@render renderEntityList($plugins, 'plugin', handleCreate, 'New Plugin Name')}

					<!-- Settings View -->
				{:else if view === 'settings'}
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
							<Button variant="outline" class="gap-1.5" onclick={handleToggleAppDebug}
								><RefreshCw class="size-4" /> Toggle Theme Setting</Button
							>
						</CardContent>
					</Card>

					<!-- Chats View -->
				{:else if view === 'chats'}
					<div class="flex gap-6">
						<!-- Chats List -->
						<div class="flex [flex:2] flex-col gap-3">
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
										onclick={() => handleSelectChat(chat.id)}
									>
										<CardContent class="p-4">
											{#if editModeId === chat.id}
												<div class="flex gap-2" onclick={(e) => e.stopPropagation()}>
													<Input bind:value={editNameInput} class="flex-1" />
													<Button
														size="sm"
														class="gap-1.5"
														onclick={() => handleUpdateChat(chat.id)}
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
																startEditMode(chat.id, chat.title);
															}}><Pencil class="size-4" /></Button
														>
														<Button
															size="sm"
															variant="destructive"
															onclick={(e) => {
																e.stopPropagation();
																handleDeleteChat(chat.id);
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
							{@render renderEntityList(
								$characterLorebooks,
								'characterLorebook',
								handleCreate,
								'Name'
							)}
							<Separator class="my-2" />
							<h3 class="font-semibold">Char Scripts</h3>
							{@render renderEntityList($characterScripts, 'characterScript', handleCreate, 'Name')}
						</div>
					</div>

					<!-- Chat View -->
				{:else if view === 'chat'}
					<div class="flex gap-6 h-full">
						<!-- Message Area -->
						<div class="flex [flex:2] flex-col rounded-lg border bg-card h-[calc(100vh-130px)]">
							<ScrollArea class="flex-1 p-4">
								<div class="flex flex-col gap-4">
									{#each $displayMessages as msg (msg.id)}
										<Message
											message={msg}
											isEditing={editModeId === msg.id}
											bind:editText={editMessageText}
											onEdit={() => { editModeId = msg.id; editMessageText = msg.content; }}
											onSave={() => handleUpdateMessage(msg.id)}
											onDelete={() => handleDeleteMessage(msg.id)}
											onCancelEdit={() => (editModeId = null)}
											onDismissError={handleDismissError}
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
									<Button variant="destructive" class="gap-1.5" onclick={handleStopGeneration}>
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
							{@render renderEntityList($chatLorebooks, 'chatLorebook', handleCreate, 'Name')}
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</main>
