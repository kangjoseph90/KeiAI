import { get } from 'svelte/store';
import {
    CharacterService,
    LorebookService,
    ScriptService,
    CharJSService,
    ModuleService,
    type CharacterFields,
    type CharacterContent,
    type Character,
    type LorebookFields,
    type ScriptFields,
    type CharJSFields,
    type Lorebook,
    type Script,
    type CharJS
} from '$lib/services';
import { AssetService } from '$lib/services/asset';
import type { FolderDef, EntityListConfig } from '$lib/types/refs';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import {
    characters,
    activeCharacter,
    characterLorebooks,
    characterScripts,
    characterCharJS,
    activeCharacterId
} from '../state';
import { getAppSettings, updateSettings } from './settings';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import type { DeepPartial } from '$lib/utils/defaults';

/**
 * Returns character from store cache first, then from DB if needed.
 * Returns null if not found.
 */
export async function getCharacter(characterId: string): Promise<Character | null> {
    const active = get(activeCharacter);
    if (active?.id === characterId) return active;
    const cached = characters.get(characterId);
    if (cached) return cached;
    const fetched = await CharacterService.get(characterId);
    if (fetched) characters.set(characterId, fetched);
    return fetched;
}

/**
 * Returns lorebooks owned by a character.
 * Uses store cache for the active character, falls back to refs-based individual gets
 * (avoids listByOwner which bypasses the record buffer LRU cache).
 */
export async function getCharacterLorebooks(characterId: string): Promise<Lorebook[]> {
    if (characterId === get(activeCharacterId)) {
        return get(characterLorebooks);
    }
    const char = await getCharacter(characterId);
    if (!char) return [];
    const results = await Promise.all(
        Object.keys(char.lorebooks.refs).map((id) => LorebookService.get(id))
    );
    return results.filter((lb): lb is Lorebook => lb !== null);
}

/**
 * Returns scripts owned by a character.
 * Uses store cache for the active character, falls back to refs-based individual gets
 * (avoids listByOwner which bypasses the record buffer LRU cache).
 */
export async function getCharacterScripts(characterId: string): Promise<Script[]> {
    if (characterId === get(activeCharacterId)) {
        return get(characterScripts);
    }
    const char = await getCharacter(characterId);
    if (!char) return [];
    const results = await Promise.all(
        Object.keys(char.scripts.refs).map((id) => ScriptService.get(id))
    );
    return results.filter((sc): sc is Script => sc !== null);
}

/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadCharacters(): Promise<void> {
    const settings = await getAppSettings();
    const list = await CharacterService.list();
    characters.setAll(sortByRefs(list, settings.characters.refs));
}

export async function selectCharacter(characterId: string): Promise<void> {
    const character = await getCharacter(characterId);
    if (!character) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);

    characters.set(character.id, character);
    activeCharacterId.set(character.id);

    const moduleIds = Object.keys(character.modules.refs);
    const [lorebooks, scripts, charjs, moduleEntries] = await Promise.all([
        LorebookService.listByOwner(characterId),
        ScriptService.listByOwner(characterId),
        CharJSService.listByOwner(characterId),
        Promise.all(moduleIds.map(async (id) => [id, await ModuleService.get(id)] as const))
    ]);

    const staleModuleRefs: Record<string, undefined> = {};
    for (const [id, mod] of moduleEntries) {
        if (!mod) {
            staleModuleRefs[id] = undefined;
        }
    }

    characterLorebooks.setAll(sortByRefs(lorebooks, character.lorebooks.refs));
    characterScripts.setAll(sortByRefs(scripts, character.scripts.refs));
    characterCharJS.setAll(sortByRefs(charjs, character.charjs.refs));

    if (Object.keys(staleModuleRefs).length > 0) {
        await updateCharacter(characterId, {
            modules: { refs: staleModuleRefs }
        });
    }
}

export function clearActiveCharacter(): void {
    activeCharacterId.set(null);
    characterLorebooks.clear();
    characterScripts.clear();
    characterCharJS.clear();
}

export async function updateCharacter(
    characterId: string,
    changes: DeepPartial<CharacterFields>
): Promise<void> {
    const updated = await CharacterService.update(characterId, changes);
    characters.set(characterId, updated);
}

export async function updateCharacterContent(
    characterId: string,
    changes: DeepPartial<CharacterContent>
): Promise<void> {
    const updated = await CharacterService.updateContent(characterId, changes);
    characters.set(characterId, updated);
}

export async function createCharacter(
    fields: DeepPartial<CharacterFields> = {}
): Promise<Character> {
    const settings = await getAppSettings();

    // Create record in DB
    const character = await CharacterService.create(fields);

    // Add to parent's refs
    const sortOrder = generateSortOrder(settings.characters.refs);
    try {
        await updateSettings({
            characters: { refs: { [character.id]: { id: character.id, sortOrder } } }
        });
    } catch (error) {
        // If parent's refs update fails, roll back DB
        await CharacterService.delete(character.id);
        throw error;
    }

    // Update store
    characters.set(character.id, character);
    return character;
}

// ─── Greeting CRUD ───────────────────────────────────────────────

export async function createCharacterGreeting(
    characterId: string,
    content: string
): Promise<{ greetingId: string; character: Character }> {
    const { greetingId, character: updated } = await CharacterService.createGreeting(
        characterId,
        content
    );

    characters.set(characterId, updated);
    return { greetingId, character: updated };
}

export async function updateCharacterGreeting(
    characterId: string,
    greetingId: string,
    content: string
): Promise<Character> {
    const updated = await CharacterService.updateGreeting(characterId, greetingId, content);

    characters.set(characterId, updated);
    return updated;
}

export async function deleteCharacterGreeting(
    characterId: string,
    greetingId: string
): Promise<Character> {
    const updated = await CharacterService.deleteGreeting(characterId, greetingId);

    characters.set(characterId, updated);
    return updated;
}

export async function updateCharacterAvatar(characterId: string, file: File): Promise<void> {
    const character = await getCharacter(characterId);
    if (!character) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);
    const oldAssetId = character.avatarAssetId;

    const newAssetId = await AssetService.write(file, 'resource');
    await updateCharacter(characterId, { avatarAssetId: newAssetId });

    if (oldAssetId) {
        await AssetService.delete(oldAssetId).catch(() => {});
    }
}

export async function removeCharacterAvatar(characterId: string): Promise<void> {
    const character = await getCharacter(characterId);
    if (!character) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);
    const oldAssetId = character.avatarAssetId;

    if (!oldAssetId) return;

    await updateCharacter(characterId, { avatarAssetId: undefined });
    await AssetService.delete(oldAssetId).catch(() => {});
}

export async function deleteCharacter(characterId: string): Promise<void> {
    const settings = await getAppSettings();

    // Capture ref for potential rollback
    const existingRef = settings.characters.refs[characterId];

    // Remove from parent's refs
    await updateSettings({ characters: { refs: { [characterId]: undefined } } });

    // Remove record from DB
    try {
        await CharacterService.delete(characterId);
    } catch (error) {
        // If DB delete fails, roll back parent's refs
        await updateSettings({ characters: { refs: { [characterId]: existingRef } } });
        throw error;
    }

    // Update Store
    characters.delete(characterId);
    if (get(activeCharacterId) === characterId) {
        clearActiveCharacter();
    }
}

// ─── Character-owned Lorebook CRUD ─────────────────────────────────

export async function createCharacterLorebook(
    characterId: string,
    fields: DeepPartial<LorebookFields>
): Promise<Lorebook> {
    const char = await getCharacter(characterId);
    if (!char) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);

    const lb = await LorebookService.create(characterId, fields);

    const sortOrder = generateSortOrder(char.lorebooks.refs);
    try {
        await updateCharacter(characterId, {
            lorebooks: { refs: { [lb.id]: { id: lb.id, sortOrder } } }
        });
    } catch (error) {
        await LorebookService.delete(lb.id);
        throw error;
    }

    if (characterId === get(activeCharacterId)) {
        characterLorebooks.set(lb.id, lb);
    }

    return lb;
}

export async function deleteCharacterLorebook(
    characterId: string,
    lorebookId: string
): Promise<void> {
    const char = await getCharacter(characterId);
    if (!char) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);

    // Capture ref for potential rollback
    const existingRef = char.lorebooks.refs[lorebookId];

    // Remove from parent's refs
    await updateCharacter(characterId, { lorebooks: { refs: { [lorebookId]: undefined } } });

    try {
        await LorebookService.delete(lorebookId);
    } catch (error) {
        await updateCharacter(characterId, { lorebooks: { refs: { [lorebookId]: existingRef } } });
        throw error;
    }

    if (characterId === get(activeCharacterId)) {
        characterLorebooks.delete(lorebookId);
    }
}

export async function updateCharacterLorebook(
    characterId: string,
    lorebookId: string,
    changes: DeepPartial<LorebookFields>
): Promise<void> {
    const updated = await LorebookService.update(lorebookId, changes);
    if (characterId === get(activeCharacterId)) {
        characterLorebooks.set(lorebookId, updated);
    }
}

// ─── Character-owned Script CRUD ───────────────────────────────────

export async function createCharacterScript(
    characterId: string,
    fields: DeepPartial<ScriptFields>
): Promise<Script> {
    const char = await getCharacter(characterId);
    if (!char) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);

    const sc = await ScriptService.create(characterId, fields);

    const sortOrder = generateSortOrder(char.scripts.refs);
    try {
        await updateCharacter(characterId, {
            scripts: { refs: { [sc.id]: { id: sc.id, sortOrder } } }
        });
    } catch (error) {
        await ScriptService.delete(sc.id);
        throw error;
    }

    if (characterId === get(activeCharacterId)) {
        characterScripts.set(sc.id, sc);
    }

    return sc;
}

export async function deleteCharacterScript(characterId: string, scriptId: string): Promise<void> {
    const char = await getCharacter(characterId);
    if (!char) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);

    // Capture ref for potential rollback
    const existingRef = char.scripts.refs[scriptId];

    // Remove from parent's refs
    await updateCharacter(characterId, { scripts: { refs: { [scriptId]: undefined } } });

    try {
        await ScriptService.delete(scriptId);
    } catch (error) {
        await updateCharacter(characterId, { scripts: { refs: { [scriptId]: existingRef } } });
        throw error;
    }

    if (characterId === get(activeCharacterId)) {
        characterScripts.delete(scriptId);
    }
}

export async function updateCharacterScript(
    characterId: string,
    scriptId: string,
    changes: DeepPartial<ScriptFields>
): Promise<void> {
    const updated = await ScriptService.update(scriptId, changes);
    if (characterId === get(activeCharacterId)) {
        characterScripts.set(scriptId, updated);
    }
}

// ─── Character-owned CharJS CRUD ───────────────────────────────────

export async function createCharacterCharJS(
    characterId: string,
    fields: DeepPartial<CharJSFields>
): Promise<CharJS> {
    const char = await getCharacter(characterId);
    if (!char) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);
    const cjs = await CharJSService.create(characterId, fields);

    const sortOrder = generateSortOrder(char.charjs.refs);
    try {
        await updateCharacter(characterId, {
            charjs: { refs: { [cjs.id]: { id: cjs.id, sortOrder } } }
        });
    } catch (error) {
        await CharJSService.delete(cjs.id);
        throw error;
    }

    if (characterId === get(activeCharacterId)) {
        characterCharJS.set(cjs.id, cjs);
    }

    return cjs;
}

export async function deleteCharacterCharJS(characterId: string, charjsId: string): Promise<void> {
    const char = await getCharacter(characterId);
    if (!char) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);

    // Capture ref for potential rollback
    const existingRef = char.charjs.refs[charjsId];

    // Remove from parent's refs
    await updateCharacter(characterId, { charjs: { refs: { [charjsId]: undefined } } });

    try {
        await CharJSService.delete(charjsId);
    } catch (error) {
        await updateCharacter(characterId, { charjs: { refs: { [charjsId]: existingRef } } });
        throw error;
    }

    if (characterId === get(activeCharacterId)) {
        characterCharJS.delete(charjsId);
    }
}

export async function updateCharacterCharJS(
    characterId: string,
    charjsId: string,
    changes: DeepPartial<CharJSFields>
): Promise<void> {
    const updated = await CharJSService.update(charjsId, changes);
    if (characterId === get(activeCharacterId)) {
        characterCharJS.set(charjsId, updated);
    }
}

// ─── Character-owned Folder & Item Management ──────────────────────

export type CharacterFolderType = 'lorebooks' | 'scripts' | 'modules' | 'charjs';

export async function createCharacterFolder(
    characterId: string,
    folderType: CharacterFolderType,
    name: string,
    parentId?: string
): Promise<FolderDef> {
    const char = await getCharacter(characterId);
    if (!char) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);

    const newFolder: FolderDef = {
        id: generateId(),
        name,
        sortOrder: generateSortOrder(char[folderType].folders),
        parentId
    };

    await updateCharacter(characterId, {
        [folderType]: { folders: { [newFolder.id]: newFolder } }
    });

    return newFolder;
}

export async function updateCharacterFolder(
    characterId: string,
    folderType: CharacterFolderType,
    folderId: string,
    changes: DeepPartial<{ name: string; color: string; parentId: string; sortOrder: string }>
): Promise<void> {
    const char = await getCharacter(characterId);
    if (!char) return;

    const existing = char[folderType].folders[folderId];
    if (!existing) return;

    const updated: FolderDef = { ...existing, ...changes, id: existing.id };

    await updateCharacter(characterId, {
        [folderType]: { folders: { [folderId]: updated } }
    });
}

export async function deleteCharacterFolder(
    characterId: string,
    folderType: CharacterFolderType,
    folderId: string
): Promise<void> {
    await updateCharacter(characterId, {
        [folderType]: { folders: { [folderId]: undefined } }
    });
}

export async function moveCharacterItem(
    characterId: string,
    folderType: CharacterFolderType,
    itemId: string,
    newFolderId?: string,
    newSortOrder?: string
): Promise<void> {
    const char = await getCharacter(characterId);
    if (!char) return;

    const existing = char[folderType].refs[itemId];
    if (!existing) return;

    await updateCharacter(characterId, {
        [folderType]: {
            refs: {
                [itemId]: {
                    ...existing,
                    folderId: newFolderId,
                    sortOrder: newSortOrder ?? existing.sortOrder
                }
            }
        }
    });
}
