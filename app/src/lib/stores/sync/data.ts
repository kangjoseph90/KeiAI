import { get } from 'svelte/store';
import { localDB } from '$lib/adapters/db';
import {
    MessageService,
    ChatService,
    RoomService,
    CharacterService,
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
    characters,
    messages,
    modules,
    multiRoomCharacters,
    multiRoomPersonas,
    multiRooms,
    personas,
    plugins,
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

    reorderStoreByRefs(rooms, settings.rooms.refs);
    reorderStoreByRefs(multiRooms, settings.multiRooms.refs);
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
                        }
                        break;
                    }
                    case 'modules': {
                        const synced = await patchEntityStoreByIds(ids, modules, ModuleService.get);
                        const currentModuleId = get(activeModuleId);
                        if (currentModuleId && ids.includes(currentModuleId)) {
                            const detail = synced.get(currentModuleId) ?? null;
                            if (!detail && get(activeModuleId) === currentModuleId) {
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
                            if (!detail && get(activeCharacterId) === currentCharacterId) {
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
