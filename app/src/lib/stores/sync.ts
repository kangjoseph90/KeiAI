import { get } from 'svelte/store';
import { AssetSyncService, DataSyncService, ProfileSyncService } from '$lib/services/sync';
import type { SyncStatus } from '$lib/services/sync/base';
import {
    appSettings,
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
    characterCharJS,
    characterModules,
    chatLorebooks,
    chatScripts,
    characters,
    personas,
    presets,
    modules,
    plugins,
    moduleResources,
    activePreset,
    activePersona,
    type ModuleResourceEntry
} from './state';
import { localDB } from '$lib/adapters/db';
import {
    MessageService,
    ChatService,
    CharacterService,
    LorebookService,
    ScriptService,
    CharJSService,
    PersonaService,
    PresetService,
    ModuleService,
    PluginService,
    type Lorebook,
    type Script,
    type CharJS,
    type Module
} from '$lib/services';
import { clearActiveCharacter } from './content/character';
import { clearActiveChat } from './content/chat';
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
    refs?: OrderedRef[]
): void {
    store.setAll(sortByRefs(get(store), refs ?? []));
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

    reorderStoreByRefs(characters, settings.characterRefs);
    reorderStoreByRefs(personas, settings.personaRefs);
    reorderStoreByRefs(presets, settings.presetRefs);
    reorderStoreByRefs(modules, settings.moduleRefs);
    reorderStoreByRefs(plugins, settings.pluginRefs);
}

async function syncActivePresetFromSettings(): Promise<void> {
    const settings = get(appSettings);
    const presetId = settings?.presetId;
    if (!presetId) {
        activePreset.set(null);
        return;
    }

    const cached = presets.get(presetId);
    if (cached) {
        activePreset.set(cached);
        return;
    }

    const resolved = await PresetService.get(presetId);
    if (resolved) {
        presets.set(resolved.id, resolved);
        activePreset.set(resolved);
    } else {
        activePreset.set(null);
    }
}

async function syncActivePersonaFromSettings(): Promise<void> {
    const settings = get(appSettings);
    const personaId = settings?.personaId;
    if (!personaId) {
        activePersona.set(null);
        return;
    }

    const cached = personas.get(personaId);
    if (cached) {
        activePersona.set(cached);
        return;
    }

    const resolved = await PersonaService.get(personaId);
    if (resolved) {
        personas.set(resolved.id, resolved);
        activePersona.set(resolved);
    } else {
        activePersona.set(null);
    }
}

function refreshCharacterModulesStore(): void {
    const character = get(activeCharacter);
    if (!character) {
        characterModules.clear();
        return;
    }

    const moduleRefs = character.moduleRefs ?? [];
    const activeModuleIds = new Set(moduleRefs.map((ref) => ref.id));
    const selectedModules = get(modules).filter((module) => activeModuleIds.has(module.id));

    characterModules.setAll(sortByRefs(selectedModules, moduleRefs));
}

function ensureModuleResourceEntry(moduleId: string): ModuleResourceEntry | null {
    const stores = get(moduleResources);
    const existing = stores.get(moduleId);
    if (existing) return existing;

    if (!modules.has(moduleId)) return null;

    const entry = {
        lorebooks: new EntityStore<Lorebook>(),
        scripts: new EntityStore<Script>(),
        charjs: new EntityStore<CharJS>()
    };

    moduleResources.update((current) => new Map(current).set(moduleId, entry));
    return entry;
}

async function backfillModuleResources(
    module: Module,
    resource: ModuleResourceEntry
): Promise<void> {
    const [lorebooks, scripts, charjs] = await Promise.all([
        LorebookService.listByOwner(module.id),
        ScriptService.listByOwner(module.id),
        CharJSService.listByOwner(module.id)
    ]);

    resource.lorebooks.setAll(sortByRefs(lorebooks, module.lorebookRefs ?? []));
    resource.scripts.setAll(sortByRefs(scripts, module.scriptRefs ?? []));
    resource.charjs.setAll(sortByRefs(charjs, module.charjsRefs ?? []));
}

async function syncLorebooksByIds(ids: string[]): Promise<void> {
    const entries = await Promise.all(
        ids.map(async (id) => [id, await LorebookService.get(id)] as const)
    );
    const currentCharacterId = get(activeCharacterId);
    const currentChatId = get(activeChatId);
    const moduleStores = get(moduleResources);

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

    for (const [, moduleStore] of moduleStores) {
        moduleStore.lorebooks.batch(() => {
            for (const [id] of entries) {
                moduleStore.lorebooks.delete(id);
            }
        });
    }

    for (const [id, lorebook] of entries) {
        if (!lorebook) continue;
        const moduleStore = ensureModuleResourceEntry(lorebook.ownerId);
        if (moduleStore) {
            moduleStore.lorebooks.set(id, lorebook);
        }
    }

    const character = get(activeCharacter);
    if (character) {
        reorderStoreByRefs(characterLorebooks, character.lorebookRefs);
    }

    const chat = get(activeChat);
    if (chat) {
        reorderStoreByRefs(chatLorebooks, chat.lorebookRefs);
    }

    for (const [moduleId, moduleStore] of moduleStores) {
        const module = modules.get(moduleId);
        if (!module) continue;
        reorderStoreByRefs(moduleStore.lorebooks, module.lorebookRefs);
    }
}

async function syncScriptsByIds(ids: string[]): Promise<void> {
    const entries = await Promise.all(
        ids.map(async (id) => [id, await ScriptService.get(id)] as const)
    );
    const currentCharacterId = get(activeCharacterId);
    const currentChatId = get(activeChatId);
    const moduleStores = get(moduleResources);

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

    for (const [, moduleStore] of moduleStores) {
        moduleStore.scripts.batch(() => {
            for (const [id] of entries) {
                moduleStore.scripts.delete(id);
            }
        });
    }

    for (const [id, script] of entries) {
        if (!script) continue;
        const moduleStore = ensureModuleResourceEntry(script.ownerId);
        if (moduleStore) {
            moduleStore.scripts.set(id, script);
        }
    }

    const character = get(activeCharacter);
    if (character) {
        reorderStoreByRefs(characterScripts, character.scriptRefs);
    }

    for (const [moduleId, moduleStore] of moduleStores) {
        const module = modules.get(moduleId);
        if (!module) continue;
        reorderStoreByRefs(moduleStore.scripts, module.scriptRefs);
    }
}

async function syncCharJSByIds(ids: string[]): Promise<void> {
    const entries = await Promise.all(
        ids.map(async (id) => [id, await CharJSService.get(id)] as const)
    );
    const currentCharacterId = get(activeCharacterId);
    const moduleStores = get(moduleResources);

    characterCharJS.batch(() => {
        for (const [id, charjs] of entries) {
            characterCharJS.delete(id);
            if (charjs && currentCharacterId && charjs.ownerId === currentCharacterId) {
                characterCharJS.set(id, charjs);
            }
        }
    });

    for (const [, moduleStore] of moduleStores) {
        moduleStore.charjs.batch(() => {
            for (const [id] of entries) {
                moduleStore.charjs.delete(id);
            }
        });
    }

    for (const [id, charjs] of entries) {
        if (!charjs) continue;
        const moduleStore = ensureModuleResourceEntry(charjs.ownerId);
        if (moduleStore) {
            moduleStore.charjs.set(id, charjs);
        }
    }

    const character = get(activeCharacter);
    if (character) {
        reorderStoreByRefs(characterCharJS, character.charjsRefs);
    }

    for (const [moduleId, moduleStore] of moduleStores) {
        const module = modules.get(moduleId);
        if (!module) continue;
        reorderStoreByRefs(moduleStore.charjs, module.charjsRefs);
    }
}

export function startSyncStatusTracking(): void {
    if (stopTracking) return;

    const unsubscribers = [
        DataSyncService.subscribeStatus((status: SyncStatus) => {
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
                    case 'settings': {
                        await loadSettings();
                        reorderGlobalStoresBySettings();
                        await Promise.all([
                            syncActivePresetFromSettings(),
                            syncActivePersonaFromSettings()
                        ]);
                        refreshCharacterModulesStore();
                        break;
                    }
                    case 'personas': {
                        const synced = await patchEntityStoreByIds(
                            ids,
                            personas,
                            PersonaService.get
                        );

                        const current = get(activePersona);
                        if (current && ids.includes(current.id)) {
                            activePersona.set(synced.get(current.id) ?? null);
                        }
                        await syncActivePersonaFromSettings();
                        break;
                    }
                    case 'presets': {
                        const synced = await patchEntityStoreByIds(ids, presets, PresetService.get);

                        const current = get(activePreset);
                        if (current && ids.includes(current.id)) {
                            activePreset.set(synced.get(current.id) ?? null);
                        }
                        await syncActivePresetFromSettings();
                        break;
                    }
                    case 'modules': {
                        const synced = await patchEntityStoreByIds(ids, modules, ModuleService.get);

                        moduleResources.update((current) => {
                            const next = new Map(current);
                            for (const [id, module] of synced.entries()) {
                                if (!module) {
                                    next.delete(id);
                                } else if (!next.has(id)) {
                                    next.set(id, {
                                        lorebooks: new EntityStore<Lorebook>(),
                                        scripts: new EntityStore<Script>(),
                                        charjs: new EntityStore<CharJS>()
                                    });
                                }
                            }
                            return next;
                        });

                        const resources = get(moduleResources);
                        for (const [id, module] of synced.entries()) {
                            if (!module) continue;
                            const resource = resources.get(id);
                            if (!resource) continue;

                            // Backfill resources for newly added modules to resolve sync race conditions
                            if (ids.includes(id)) {
                                void backfillModuleResources(module, resource);
                            }

                            reorderStoreByRefs(resource.lorebooks, module.lorebookRefs);
                            reorderStoreByRefs(resource.scripts, module.scriptRefs);
                            reorderStoreByRefs(resource.charjs, module.charjsRefs);
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

                        const currentCharacterId = get(activeCharacterId);
                        if (currentCharacterId && ids.includes(currentCharacterId)) {
                            const detail = synced.get(currentCharacterId) ?? null;

                            if (detail && get(activeCharacterId) === currentCharacterId) {
                                activeCharacter.set(detail);
                                reorderStoreByRefs(chats, detail.chatRefs);
                                reorderStoreByRefs(characterLorebooks, detail.lorebookRefs);
                                reorderStoreByRefs(characterScripts, detail.scriptRefs);
                                reorderStoreByRefs(characterCharJS, detail.charjsRefs);
                            } else if (get(activeCharacterId) === currentCharacterId) {
                                clearActiveCharacter();
                            }
                        }

                        refreshCharacterModulesStore();
                        break;
                    }
                    case 'chats': {
                        const currentCharacterId = get(activeCharacterId);
                        if (!currentCharacterId) break;

                        const synced = await patchEntityStoreByIds(
                            ids,
                            chats,
                            ChatService.get,
                            (chat) => chat.characterId === currentCharacterId
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

                        const character = get(activeCharacter);
                        if (character) {
                            reorderStoreByRefs(chats, character.chatRefs);
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
