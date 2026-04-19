import { get } from 'svelte/store';
import { AssetSyncService, DataSyncService, ProfileSyncService } from '$lib/services/sync';
import {
	assetSyncStatus,
	dataSyncStatus,
	profileSyncStatus,
	activeCharacterId,
	activeChatId,
	messages,
	chats,
	activeChat,
	activeCharacter,
	characterLorebooks,
	characterScripts,
	chatLorebooks
} from './state';
import { localDB, type DatabaseWriteEvent } from '$lib/adapters/db';
import {
	MessageService,
	ChatService,
	CharacterService,
	LorebookService,
	ScriptService
} from '$lib/services';
import { loadCharacters, getCharacter } from './content/character';
import { getChat } from './content/chat';
import { loadPersonas } from './content/persona';
import { loadPresets } from './content/preset';
import { loadModules } from './content/module';
import { loadPlugins } from './content/plugin';
import { loadSettings } from './content/settings';
import { sortByRefs } from '$lib/utils/ordering';

let stopTracking: (() => void) | null = null;
let stopDataListener: (() => void) | null = null;

export function startSyncStatusTracking(): void {
	if (stopTracking) return;

	const unsubscribers = [
		DataSyncService.subscribeStatus((status) => {
			dataSyncStatus.set(status);
		}),
		ProfileSyncService.subscribeStatus((status) => {
			profileSyncStatus.set(status);
		}),
		AssetSyncService.subscribeStatus((status) => {
			assetSyncStatus.set(status);
		})
	];

	if (!stopDataListener) {
		stopDataListener = startDataSyncListener();
	}

	stopTracking = () => {
		for (const unsubscribe of unsubscribers) {
			unsubscribe();
		}

		dataSyncStatus.set({ state: 'idle' });
		profileSyncStatus.set({ state: 'idle' });
		assetSyncStatus.set({ state: 'idle', pendingCount: 0 });
		stopTracking = null;

		if (stopDataListener) {
			stopDataListener();
			stopDataListener = null;
		}
	};
}

export function stopSyncStatusTracking(): void {
	stopTracking?.();
}

/**
 * Listens to local DB write events coming from the Sync layer ("origin: 'sync'").
 * Partially or globally reloads Svelte stores to reflect new synced data.
 */
function startDataSyncListener(): () => void {
	return localDB.subscribeWriteEvents(async (events) => {
		// Deduplicate events by table name
		const mergedEvents: Record<string, string[]> = {};
		for (const event of events) {
			if (event.origin !== 'sync') continue;
			if (!mergedEvents[event.tableName]) {
				mergedEvents[event.tableName] = [];
			}
			mergedEvents[event.tableName].push(...event.ids);
		}

		for (const [tableName, allIds] of Object.entries(mergedEvents)) {
			// Deduplicate IDs within each table
			const ids = Array.from(new Set(allIds));

			try {
				switch (tableName) {
					case 'settings':
						await loadSettings();
						break;
					case 'personas':
						await loadPersonas();
						break;
					case 'presets':
						await loadPresets();
						break;
					case 'modules':
						await loadModules();
						break;
					case 'plugins':
						await loadPlugins();
						break;
					case 'characters': {
						await loadCharacters();
						const charId = get(activeCharacterId);
						if (charId && ids.includes(charId)) {
							const detail = await CharacterService.get(charId);
							if (detail && get(activeCharacterId) === charId) {
								activeCharacter.set(detail);
							}
						}
						break;
					}
					case 'chats': {
						const currentCharId = get(activeCharacterId);
						if (currentCharId) {
							const char = await getCharacter(currentCharId);
							const chatList = await ChatService.listByCharacter(currentCharId);

							if (get(activeCharacterId) === currentCharId) {
								chats.setAll(sortByRefs(chatList, char.chatRefs ?? []));

								const chatId = get(activeChatId);
								if (chatId && ids.includes(chatId)) {
									const detail = await ChatService.get(chatId);
									if (detail && get(activeChatId) === chatId) {
										activeChat.set(detail);
									}
								}
							}
						}
						break;
					}
					case 'messages': {
						const currentChatId = get(activeChatId);
						if (currentChatId) {
							const msgs = await Promise.all(ids.map((id) => MessageService.get(id)));

							messages.batch(() => {
								for (let i = 0; i < ids.length; i++) {
									const id = ids[i];
									const msg = msgs[i];
									if (!msg || msg.chatId !== currentChatId) {
										messages.delete(id);
									} else {
										messages.set(id, msg);
									}
								}
							});
						}
						break;
					}
					case 'lorebooks':
					case 'scripts': {
						const currentCharId = get(activeCharacterId);
						if (currentCharId) {
							const char = await getCharacter(currentCharId);
							if (tableName === 'lorebooks') {
								const list = await LorebookService.listByOwner(currentCharId);
								if (get(activeCharacterId) === currentCharId) {
									characterLorebooks.setAll(sortByRefs(list, char.lorebookRefs ?? []));
								}
							} else {
								const list = await ScriptService.listByOwner(currentCharId);
								if (get(activeCharacterId) === currentCharId) {
									characterScripts.setAll(sortByRefs(list, char.scriptRefs ?? []));
								}
							}
						}

						const currentChatId = get(activeChatId);
						if (currentChatId && tableName === 'lorebooks') {
							const chat = await getChat(currentChatId);
							const list = await LorebookService.listByOwner(currentChatId);
							if (get(activeChatId) === currentChatId) {
								chatLorebooks.setAll(sortByRefs(list, chat.lorebookRefs ?? []));
							}
						}
						break;
					}
				}
			} catch (err) {
				console.warn(`[DataSyncListener] Error handling ${tableName}`, err);
			}
		}
	});
}
