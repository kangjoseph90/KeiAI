import { get } from 'svelte/store';
import { AssetSyncService, DataSyncService, UserSyncService } from '$lib/services/sync';
import type { SyncStatus } from '$lib/services/sync/base';
import {
    appSettings,
    assetSyncStatus,
    dataSyncStatus,
    userSyncStatus,
    activeRoomId,
    activeCharacterId,
    activeChatId,
    rooms,
    activeRoom,
    roomCharacters,
    messages,
    chats,
    activeChat,
    activeCharacter,
    characterLorebooks,
    characterScripts,
    characterCharJS,
    characterModules,
    chatLorebooks,
    chatScripts,
    chatPersonas,
    activeModule,
    activeModuleId,
    moduleLorebooks,
    moduleScripts,
    moduleCharJS,
    activePreset,
    presetScripts,
    characters,
    personas,
    presets,
    modules,
    plugins
} from './state';
import { localDB } from '$lib/adapters/db';
import {
    MessageService,
    ChatService,
    RoomService,
    CharacterService,
    LorebookService,
    ScriptService,
    CharJSService,
    PersonaService,
    PresetService,
    ModuleService,
    PluginService
} from '$lib/services';
import { clearActiveCharacter } from './content/character';
import { clearActiveChat } from './content/chat';
import { clearActiveRoom } from './content/room';
import { loadSettings } from './content/settings';
import { sortByRefs } from '$lib/utils/ordering';
import { EntityStore } from './entity_store';
import type { OrderedRef } from '$lib/types/refs';
import { createLogger } from '$lib/adapters/logger';

let stopTracking: (() => void) | null = null;
let stopDataListener: (() => void) | null = null;
const logger = createLogger('store:sync');

function reorderStoreByRefs<T extends { id: string }>(
    store: EntityStore<T>,
    refs: Record<string, OrderedRef>
): void {
    store.setAll(sortByRefs(get(store), refs));
}

async function patchEntityStoreByIds<T extends { id: string }>(
    ids: string[],
    store: EntityStore<T>,
    loadById: (id: string) => Promise<T | null>,
    isRelevant?: (item: T) => boolean
): Promise<Map<string, T | null>> {
    const entries = await Promise.all(ids.map(async (id) => [id, await loadById(id)] as const));

    store.batch(() => {
        for (const [id, item] of entries) {
            if (!item || (isRelevant && !isRelevant(item))) {
                store.delete(id);
            } else {
                store.set(id, item);
            }
        }
    });

    return new Map(entries);
}

function reorderGlobalStoresBySettings(): void {
    const settings = get(appSettings);
    if (!settings) return;

    reorderStoreByRefs(characters, settings.characters.refs);
    reorderStoreByRefs(personas, settings.personas.refs);
    reorderStoreByRefs(presets, settings.presets.refs);
    reorderStoreByRefs(modules, settings.modules.refs);
    reorderStoreByRefs(plugins, settings.plugins.refs);
}

function refreshCharacterModulesStore(): void {
    const character = get(activeCharacter);
    if (!character) {
        characterModules.clear();
        return;
    }

    const moduleRefs = character.modules.refs;
    const activeModuleIds = new Set(Object.keys(moduleRefs));
    const selectedModules = get(modules).filter((module) => activeModuleIds.has(module.id));

    characterModules.setAll(sortByRefs(selectedModules, moduleRefs));
}

async function syncLorebooksByIds(ids: string[]): Promise<void> {
    const entries = await Promise.all(
        ids.map(async (id) => [id, await LorebookService.get(id)] as const)
    );
    const currentCharacterId = get(activeCharacterId);
    const currentChatId = get(activeChatId);
    const currentModuleId = get(activeModuleId);

    characterLorebooks.batch(() => {
        for (const [id, lorebook] of entries) {
            characterLorebooks.delete(id);
            if (lorebook && currentCharacterId && lorebook.ownerId === currentCharacterId) {
                characterLorebooks.set(id, lorebook);
            }
        }
    });

    chatLorebooks.batch(() => {
        for (const [id, lorebook] of entries) {
            chatLorebooks.delete(id);
            if (lorebook && currentChatId && lorebook.ownerId === currentChatId) {
                chatLorebooks.set(id, lorebook);
            }
        }
    });

    moduleLorebooks.batch(() => {
        for (const [id, lorebook] of entries) {
            moduleLorebooks.delete(id);
            if (lorebook && currentModuleId && lorebook.ownerId === currentModuleId) {
                moduleLorebooks.set(id, lorebook);
            }
        }
    });

    const character = get(activeCharacter);
    if (character) {
        reorderStoreByRefs(characterLorebooks, character.lorebooks.refs);
    }

    const chat = get(activeChat);
    if (chat) {
        reorderStoreByRefs(chatLorebooks, chat.lorebooks.refs);
    }

    const module = get(activeModule);
    if (module) {
        reorderStoreByRefs(moduleLorebooks, module.lorebooks.refs);
    }
}

async function syncScriptsByIds(ids: string[]): Promise<void> {
    const entries = await Promise.all(
        ids.map(async (id) => [id, await ScriptService.get(id)] as const)
    );
    const currentCharacterId = get(activeCharacterId);
    const currentChatId = get(activeChatId);
    const currentModuleId = get(activeModuleId);
    const currentPresetId = get(activePreset)?.id;

    characterScripts.batch(() => {
        for (const [id, script] of entries) {
            characterScripts.delete(id);
            if (script && currentCharacterId && script.ownerId === currentCharacterId) {
                characterScripts.set(id, script);
            }
        }
    });

    chatScripts.batch(() => {
        for (const [id, script] of entries) {
            chatScripts.delete(id);
            if (script && currentChatId && script.ownerId === currentChatId) {
                chatScripts.set(id, script);
            }
        }
    });

    moduleScripts.batch(() => {
        for (const [id, script] of entries) {
            moduleScripts.delete(id);
            if (script && currentModuleId && script.ownerId === currentModuleId) {
                moduleScripts.set(id, script);
            }
        }
    });

    presetScripts.batch(() => {
        for (const [id, script] of entries) {
            presetScripts.delete(id);
            if (script && currentPresetId && script.ownerId === currentPresetId) {
                presetScripts.set(id, script);
            }
        }
    });

    const character = get(activeCharacter);
    if (character) {
        reorderStoreByRefs(characterScripts, character.scripts.refs);
    }

    const module = get(activeModule);
    if (module) {
        reorderStoreByRefs(moduleScripts, module.scripts.refs);
    }

    const preset = get(activePreset);
    if (preset) {
        reorderStoreByRefs(presetScripts, preset.scripts.refs);
    }
}

async function syncCharJSByIds(ids: string[]): Promise<void> {
    const entries = await Promise.all(
        ids.map(async (id) => [id, await CharJSService.get(id)] as const)
    );
    const currentCharacterId = get(activeCharacterId);
    const currentModuleId = get(activeModuleId);

    characterCharJS.batch(() => {
        for (const [id, charjs] of entries) {
            characterCharJS.delete(id);
            if (charjs && currentCharacterId && charjs.ownerId === currentCharacterId) {
                characterCharJS.set(id, charjs);
            }
        }
    });

    moduleCharJS.batch(() => {
        for (const [id, charjs] of entries) {
            moduleCharJS.delete(id);
            if (charjs && currentModuleId && charjs.ownerId === currentModuleId) {
                moduleCharJS.set(id, charjs);
            }
        }
    });

    const character = get(activeCharacter);
    if (character) {
        reorderStoreByRefs(characterCharJS, character.charjs.refs);
    }

    const module = get(activeModule);
    if (module) {
        reorderStoreByRefs(moduleCharJS, module.charjs.refs);
    }
}

export function startSyncStatusTracking(): void {
    if (stopTracking) return;

    const unsubscribers = [
        DataSyncService.subscribeStatus((status: SyncStatus) => {
            dataSyncStatus.set(status);
        }),
        UserSyncService.subscribeStatus((status) => {
            userSyncStatus.set(status);
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
        userSyncStatus.set({ state: 'idle' });
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
                    case 'settings': {
                        await loadSettings();
                        reorderGlobalStoresBySettings();
                        refreshCharacterModulesStore();
                        break;
                    }
                    case 'rooms': {
                        const synced = await patchEntityStoreByIds(ids, rooms, RoomService.get);

                        const currentRoomId = get(activeRoomId);
                        if (currentRoomId && ids.includes(currentRoomId)) {
                            const detail = synced.get(currentRoomId) ?? null;

                            if (detail && get(activeRoomId) === currentRoomId) {
                                activeRoom.set(detail);
                                reorderStoreByRefs(chats, detail.chats.refs);
                                reorderStoreByRefs(roomCharacters, detail.characters.refs);
                            } else if (get(activeRoomId) === currentRoomId) {
                                clearActiveRoom();
                            }
                        }
                        break;
                    }
                    case 'personas': {
                        await patchEntityStoreByIds(ids, personas, PersonaService.get);

                        const chat = get(activeChat);
                        if (chat) {
                            await patchEntityStoreByIds(
                                ids,
                                chatPersonas,
                                PersonaService.get,
                                (persona) => persona.id in chat.personas.refs
                            );
                            reorderStoreByRefs(chatPersonas, chat.personas.refs);
                        }
                        break;
                    }
                    case 'presets': {
                        const synced = await patchEntityStoreByIds(ids, presets, PresetService.get);

                        const preset = get(activePreset);
                        if (preset && ids.includes(preset.id)) {
                            const detail = synced.get(preset.id) ?? null;
                            if (detail) {
                                reorderStoreByRefs(presetScripts, detail.scripts.refs);
                            } else {
                                presetScripts.clear();
                            }
                        }
                        break;
                    }
                    case 'modules': {
                        const synced = await patchEntityStoreByIds(ids, modules, ModuleService.get);

                        const currentModuleId = get(activeModuleId);
                        if (currentModuleId && ids.includes(currentModuleId)) {
                            const detail = synced.get(currentModuleId) ?? null;
                            if (detail && get(activeModuleId) === currentModuleId) {
                                activeModule.set(detail);
                                reorderStoreByRefs(moduleLorebooks, detail.lorebooks.refs);
                                reorderStoreByRefs(moduleScripts, detail.scripts.refs);
                                reorderStoreByRefs(moduleCharJS, detail.charjs.refs);
                            } else if (get(activeModuleId) === currentModuleId) {
                                activeModule.set(null);
                                moduleLorebooks.clear();
                                moduleScripts.clear();
                                moduleCharJS.clear();
                            }
                        }

                        refreshCharacterModulesStore();
                        break;
                    }
                    case 'plugins': {
                        await patchEntityStoreByIds(ids, plugins, PluginService.get);
                        break;
                    }
                    case 'characters': {
                        const synced = await patchEntityStoreByIds(
                            ids,
                            characters,
                            CharacterService.get
                        );

                        const room = get(activeRoom);
                        if (room) {
                            await patchEntityStoreByIds(
                                ids,
                                roomCharacters,
                                CharacterService.get,
                                (character) => character.id in room.characters.refs
                            );
                            reorderStoreByRefs(roomCharacters, room.characters.refs);
                        }

                        const currentCharacterId = get(activeCharacterId);
                        if (currentCharacterId && ids.includes(currentCharacterId)) {
                            const detail = synced.get(currentCharacterId) ?? null;

                            if (detail && get(activeCharacterId) === currentCharacterId) {
                                activeCharacter.set(detail);
                                reorderStoreByRefs(characterLorebooks, detail.lorebooks.refs);
                                reorderStoreByRefs(characterScripts, detail.scripts.refs);
                                reorderStoreByRefs(characterCharJS, detail.charjs.refs);
                            } else if (get(activeCharacterId) === currentCharacterId) {
                                clearActiveCharacter();
                            }
                        }

                        refreshCharacterModulesStore();
                        break;
                    }
                    case 'chats': {
                        const currentRoomId = get(activeRoomId);
                        if (!currentRoomId) break;

                        const synced = await patchEntityStoreByIds(
                            ids,
                            chats,
                            ChatService.get,
                            (chat) => chat.roomId === currentRoomId
                        );

                        const currentChatId = get(activeChatId);
                        if (currentChatId && ids.includes(currentChatId)) {
                            const detail = synced.get(currentChatId) ?? null;
                            if (detail && get(activeChatId) === currentChatId) {
                                activeChat.set(detail);
                            } else if (get(activeChatId) === currentChatId) {
                                clearActiveChat();
                            }
                        }

                        const room = get(activeRoom);
                        if (room) {
                            reorderStoreByRefs(chats, room.chats.refs);
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
                    case 'lorebooks': {
                        await syncLorebooksByIds(ids);
                        break;
                    }
                    case 'scripts': {
                        await syncScriptsByIds(ids);
                        break;
                    }
                    case 'charjs': {
                        await syncCharJSByIds(ids);
                        break;
                    }
                }
            } catch (err) {
                logger.warn(`Error handling synced table ${tableName}`, err);
            }
        }
    });
}
