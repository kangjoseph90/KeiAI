import { get } from 'svelte/store';
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
    PluginService,
    type Character,
    type Persona,
    type Room
} from '$lib/services';
import { createLogger } from '$lib/adapters/logger';
import {
    activeCharacter,
    activeCharacterId,
    activeChat,
    activeChatId,
    activeModule,
    activeModuleId,
    activePreset,
    activePersonaId,
    activeRoom,
    activeRoomId,
    appSettings,
    characterCharJS,
    characterLorebooks,
    characterScripts,
    characters,
    chatLorebooks,
    chatScripts,
    messages,
    moduleCharJS,
    moduleLorebooks,
    moduleScripts,
    modules,
    multiRoomCharacters,
    multiRoomPersonas,
    multiRooms,
    personas,
    plugins,
    presetScripts,
    presets,
    roomChats,
    rooms
} from '../state';
import { clearActiveCharacter } from '../content/character';
import { clearActiveChat } from '../content/chat';
import { clearActiveRoom } from '../content/room';
import { clearActiveModule } from '../content/module';
import { clearActivePersona } from '../content/persona';
import { refreshMessageIndexes, shouldSyncMessage } from '../content/message';
import { loadSettings } from '../content/settings';
import { patchEntityStoreByIds, reorderStoreByRefs } from './shared';

let stopDataStoreSyncListener: (() => void) | null = null;
const logger = createLogger('store:sync:data');

function reorderGlobalStoresBySettings(): void {
    const settings = get(appSettings);
    if (!settings) return;

    reorderStoreByRefs(characters, settings.characters.refs);
    reorderStoreByRefs(personas, settings.personas.refs);
    reorderStoreByRefs(presets, settings.presets.refs);
    reorderStoreByRefs(modules, settings.modules.refs);
    reorderStoreByRefs(plugins, settings.plugins.refs);
}

function syncScopedRoomStore(id: string, room: Room | null): void {
    if (!room) {
        rooms.delete(id);
        multiRooms.delete(id);
        return;
    }

    if (room.scopeType === 'room') {
        if (room.scopeId === get(activeRoomId)) {
            multiRooms.set(room.id, room);
        }
        rooms.delete(room.id);
        return;
    }

    rooms.set(room.id, room);
    multiRooms.delete(room.id);
}

function syncScopedCharacterStore(id: string, character: Character | null): void {
    if (!character) {
        characters.delete(id);
        multiRoomCharacters.delete(id);
        return;
    }

    if (character.scopeType === 'room') {
        if (character.scopeId === get(activeRoomId)) {
            multiRoomCharacters.set(character.id, character);
        } else {
            multiRoomCharacters.delete(character.id);
        }
        characters.delete(character.id);
        return;
    }

    characters.set(character.id, character);
    multiRoomCharacters.delete(character.id);
}

function syncScopedPersonaStore(id: string, persona: Persona | null): void {
    if (!persona) {
        personas.delete(id);
        multiRoomPersonas.delete(id);
        return;
    }

    if (persona.scopeType === 'room') {
        if (persona.scopeId === get(activeRoomId)) {
            multiRoomPersonas.set(persona.id, persona);
        } else {
            multiRoomPersonas.delete(persona.id);
        }
        personas.delete(persona.id);
        return;
    }

    personas.set(persona.id, persona);
    multiRoomPersonas.delete(persona.id);
}

async function syncRoomsByIds(ids: string[]): Promise<Map<string, Room | null>> {
    const entries = await Promise.all(
        ids.map(async (id) => [id, await RoomService.get(id)] as const)
    );

    for (const [id, room] of entries) {
        syncScopedRoomStore(id, room);
    }

    return new Map(entries);
}

async function syncCharactersByIds(ids: string[]): Promise<Map<string, Character | null>> {
    const entries = await Promise.all(
        ids.map(async (id) => [id, await CharacterService.get(id)] as const)
    );

    for (const [id, character] of entries) {
        syncScopedCharacterStore(id, character);
    }

    return new Map(entries);
}

async function syncPersonasByIds(ids: string[]): Promise<void> {
    const entries = await Promise.all(
        ids.map(async (id) => [id, await PersonaService.get(id)] as const)
    );

    for (const [id, persona] of entries) {
        syncScopedPersonaStore(id, persona);
    }
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
    if (character) reorderStoreByRefs(characterLorebooks, character.lorebooks.refs);

    const chat = get(activeChat);
    if (chat) reorderStoreByRefs(chatLorebooks, chat.lorebooks.refs);

    const module = get(activeModule);
    if (module) reorderStoreByRefs(moduleLorebooks, module.lorebooks.refs);
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
    if (character) reorderStoreByRefs(characterScripts, character.scripts.refs);

    const module = get(activeModule);
    if (module) reorderStoreByRefs(moduleScripts, module.scripts.refs);

    const preset = get(activePreset);
    if (preset) reorderStoreByRefs(presetScripts, preset.scripts.refs);
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
    if (character) reorderStoreByRefs(characterCharJS, character.charjs.refs);

    const module = get(activeModule);
    if (module) reorderStoreByRefs(moduleCharJS, module.charjs.refs);
}

export function startDataStoreSync(): void {
    if (stopDataStoreSyncListener) return;

    stopDataStoreSyncListener = localDB.subscribeWriteEvents(async (events) => {
        const mergedEvents: Record<string, string[]> = {};
        for (const event of events) {
            if (event.origin !== 'sync') continue;
            mergedEvents[event.tableName] ??= [];
            mergedEvents[event.tableName].push(...event.ids);
        }

        for (const [tableName, allIds] of Object.entries(mergedEvents)) {
            const ids = Array.from(new Set(allIds));

            try {
                switch (tableName) {
                    case 'settings': {
                        await loadSettings();
                        reorderGlobalStoresBySettings();
                        break;
                    }
                    case 'rooms': {
                        const synced = await syncRoomsByIds(ids);
                        const currentRoomId = get(activeRoomId);
                        if (currentRoomId && ids.includes(currentRoomId)) {
                            const detail = synced.get(currentRoomId) ?? null;
                            if (detail && get(activeRoomId) === currentRoomId) {
                                reorderStoreByRefs(roomChats, detail.chats.refs);
                            } else if (get(activeRoomId) === currentRoomId) {
                                clearActiveRoom();
                            }
                        }
                        break;
                    }
                    case 'personas': {
                        await syncPersonasByIds(ids);
                        const currentPersonaId = get(activePersonaId);
                        if (currentPersonaId && ids.includes(currentPersonaId)) {
                            const detail =
                                personas.get(currentPersonaId) ??
                                multiRoomPersonas.get(currentPersonaId) ??
                                null;
                            if (!detail && get(activePersonaId) === currentPersonaId) {
                                clearActivePersona();
                            }
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
                                reorderStoreByRefs(moduleLorebooks, detail.lorebooks.refs);
                                reorderStoreByRefs(moduleScripts, detail.scripts.refs);
                                reorderStoreByRefs(moduleCharJS, detail.charjs.refs);
                            } else if (get(activeModuleId) === currentModuleId) {
                                clearActiveModule();
                            }
                        }
                        break;
                    }
                    case 'plugins': {
                        await patchEntityStoreByIds(ids, plugins, PluginService.get);
                        break;
                    }
                    case 'characters': {
                        const synced = await syncCharactersByIds(ids);
                        const currentCharacterId = get(activeCharacterId);
                        if (currentCharacterId && ids.includes(currentCharacterId)) {
                            const detail = synced.get(currentCharacterId) ?? null;
                            if (detail && get(activeCharacterId) === currentCharacterId) {
                                reorderStoreByRefs(characterLorebooks, detail.lorebooks.refs);
                                reorderStoreByRefs(characterScripts, detail.scripts.refs);
                                reorderStoreByRefs(characterCharJS, detail.charjs.refs);
                            } else if (get(activeCharacterId) === currentCharacterId) {
                                clearActiveCharacter();
                            }
                        }
                        break;
                    }
                    case 'chats': {
                        const currentRoomId = get(activeRoomId);
                        if (!currentRoomId) break;

                        const synced = await patchEntityStoreByIds(
                            ids,
                            roomChats,
                            ChatService.get,
                            (chat) => chat.roomId === currentRoomId
                        );

                        const currentChatId = get(activeChatId);
                        if (currentChatId && ids.includes(currentChatId)) {
                            const detail = synced.get(currentChatId) ?? null;
                            if (!detail && get(activeChatId) === currentChatId) {
                                clearActiveChat();
                            }
                        }

                        const room = get(activeRoom);
                        if (room) reorderStoreByRefs(roomChats, room.chats.refs);
                        break;
                    }
                    case 'messages': {
                        const currentChatId = get(activeChatId);
                        if (!currentChatId) break;

                        const msgs = await Promise.all(ids.map((id) => MessageService.get(id)));
                        messages.batch(() => {
                            for (let i = 0; i < ids.length; i++) {
                                const id = ids[i];
                                const msg = msgs[i];
                                if (!msg) {
                                    messages.delete(id);
                                } else if (shouldSyncMessage(currentChatId, msg)) {
                                    messages.set(id, msg);
                                }
                            }
                        });
                        await refreshMessageIndexes(currentChatId);
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
            } catch (error) {
                logger.warn(`Error handling synced table ${tableName}`, error);
            }
        }
    });
}

export function stopDataStoreSync(): void {
    stopDataStoreSyncListener?.();
    stopDataStoreSyncListener = null;
}
