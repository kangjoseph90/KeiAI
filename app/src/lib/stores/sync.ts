import { get } from 'svelte/store';
import { AssetSyncService, DataSyncService, ProfileSyncService } from '$lib/services/sync';
import {
	assetSyncStatus,
	dataSyncStatus,
	profileSyncStatus,
	activeCharacterId,
	activeChatId,
	messageMap,
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
import { loadCharacters, getCharacterDetail } from './content/character';
import { getChatDetail } from './content/chat';
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
					case 'presetSummaries':
					case 'presetData':
						await loadPresets();
						break;
					case 'modules':
						await loadModules();
						break;
					case 'plugins':
						await loadPlugins();
						break;
					case 'characterSummaries':
					case 'characterData': {
						await loadCharacters();
						const charId = get(activeCharacterId);
						if (charId && ids.includes(charId)) {
							const detail = await CharacterService.getDetail(charId);
							if (detail && get(activeCharacterId) === charId) {
								activeCharacter.set(detail);
							}
						}
						break;
					}
					case 'chatSummaries':
					case 'chatData': {
						const currentCharId = get(activeCharacterId);
						if (currentCharId) {
							// Silently refresh sidebar chat list
							const charDetail = await getCharacterDetail(currentCharId);
							const chatList = await ChatService.listByCharacter(currentCharId);

							// Guard condition after awaits
							if (get(activeCharacterId) === currentCharId) {
								chats.set(sortByRefs(chatList, charDetail.data.chatRefs ?? []));

								// Refresh active chat detail (preserve messages, only update detail)
								const chatId = get(activeChatId);
								if (chatId && ids.includes(chatId)) {
									const detail = await ChatService.getDetail(chatId);
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
							// Parallel fetch to avoid N+1
							const msgs = await Promise.all(ids.map((id) => MessageService.get(id)));

							if (get(activeChatId) === currentChatId) {
								// Single messageMap.update() to batch all changes
								messageMap.update((map) => {
									const next = new Map(map);
									for (let i = 0; i < ids.length; i++) {
										const id = ids[i];
										const msg = msgs[i];
										// Remove if deleted, not found, or belongs to a different chat
										if (!msg || msg.chatId !== currentChatId) {
											next.delete(id);
										} else {
											next.set(id, msg);
										}
									}
									return next;
								});
							}
						}
						break;
					}
					case 'lorebooks':
					case 'scripts': {
						const currentCharId = get(activeCharacterId);
						if (currentCharId) {
							const charDetail = await getCharacterDetail(currentCharId);
							if (tableName === 'lorebooks') {
								const list = await LorebookService.listByOwner(currentCharId);
								if (get(activeCharacterId) === currentCharId) {
									characterLorebooks.set(sortByRefs(list, charDetail.data.lorebookRefs ?? []));
								}
							} else {
								const list = await ScriptService.listByOwner(currentCharId);
								if (get(activeCharacterId) === currentCharId) {
									characterScripts.set(sortByRefs(list, charDetail.data.scriptRefs ?? []));
								}
							}
						}

						const currentChatId = get(activeChatId);
						if (currentChatId && tableName === 'lorebooks') {
							const chatDetail = await getChatDetail(currentChatId);
							const list = await LorebookService.listByOwner(currentChatId);
							if (get(activeChatId) === currentChatId) {
								chatLorebooks.set(sortByRefs(list, chatDetail.data.lorebookRefs ?? []));
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
