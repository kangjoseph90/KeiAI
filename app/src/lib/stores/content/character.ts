import { get } from 'svelte/store';
import {
    CharacterService,
    ChatService,
    LorebookService,
    ScriptService,
    CharJSService,
    SettingsService,
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
import type { OrderedRef, ResourceRef, FolderDef } from '$lib/types/refs';
import { clearActiveChat } from './chat';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import {
    characters,
    activeCharacter,
    characterLorebooks,
    characterScripts,
    characterCharJS,
    characterModules,
    chats,
    modules,
    appSettings,
    activeCharacterId
} from '../state';
import { getAppSettings, updateSettings } from './settings';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import type { DeepPartial } from '$lib/utils/defaults';

/**
 * Returns character from store cache first, then from DB if needed.
 * Explicitly throws error if not found
 */
export async function getCharacter(characterId: string): Promise<Character> {
    const active = get(activeCharacter);
    if (active?.id === characterId) return active;
    const cached = characters.get(characterId);
    if (cached) return cached;
    const db = await CharacterService.get(characterId);
    if (!db) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);
    return db;
}

/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadCharacters(): Promise<void> {
    const settings = await getAppSettings();
    const list = await CharacterService.list();
    if (settings?.characterRefs) {
        characters.setAll(sortByRefs(list, settings.characterRefs));
    } else {
        characters.setAll(list);
    }
}

export async function selectCharacter(characterId: string): Promise<void> {
    const character = await getCharacter(characterId);

    activeCharacter.set(character);

    clearActiveChat();
    const chatList = await ChatService.listByCharacter(characterId);
    chats.setAll(sortByRefs(chatList, character.chatRefs ?? []));

    const moduleIds = character.moduleRefs?.map((r) => r.id) ?? [];
    characterModules.setAll(get(modules).filter((m) => moduleIds.includes(m.id)));

    const [lorebooks, scripts, charjs] = await Promise.all([
        LorebookService.listByOwner(characterId),
        ScriptService.listByOwner(characterId),
        CharJSService.listByOwner(characterId)
    ]);

    characterLorebooks.setAll(sortByRefs(lorebooks, character.lorebookRefs ?? []));
    characterScripts.setAll(sortByRefs(scripts, character.scriptRefs ?? []));
    characterCharJS.setAll(sortByRefs(charjs, character.charjsRefs ?? []));
}

export function clearActiveCharacter(): void {
    activeCharacter.set(null);
    chats.clear();
    characterLorebooks.clear();
    characterScripts.clear();
    characterCharJS.clear();
    characterModules.clear();
    clearActiveChat();
}

export async function updateCharacter(
    characterId: string,
    changes: DeepPartial<CharacterFields>
): Promise<void> {
    const updated = await CharacterService.update(characterId, changes);
    characters.set(characterId, updated);
    if (characterId === get(activeCharacterId)) {
        activeCharacter.set(updated);
    }
}

export async function updateCharacterContent(
    characterId: string,
    changes: DeepPartial<CharacterContent>
): Promise<void> {
    const updated = await CharacterService.updateContent(characterId, changes);
    characters.set(characterId, updated);
    if (characterId === get(activeCharacterId)) {
        activeCharacter.set(updated);
    }
}

export async function createCharacter(
    fields: DeepPartial<CharacterFields> = {}
): Promise<Character> {
    const settings = await getAppSettings();

    // Create record in DB
    const character = await CharacterService.create(fields);

    // Add to parent's refs
    const existingRefs = settings.characterRefs || [];
    const characterRefs = [
        ...existingRefs,
        { id: character.id, sortOrder: generateSortOrder(existingRefs) }
    ];
    try {
        await updateSettings({ characterRefs });
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
    if (characterId === get(activeCharacterId)) {
        activeCharacter.set(updated);
    }
    return { greetingId, character: updated };
}

export async function updateCharacterGreeting(
    characterId: string,
    greetingId: string,
    content: string
): Promise<Character> {
    const updated = await CharacterService.updateGreeting(characterId, greetingId, content);

    characters.set(characterId, updated);
    if (characterId === get(activeCharacterId)) {
        activeCharacter.set(updated);
    }
    return updated;
}

export async function deleteCharacterGreeting(
    characterId: string,
    greetingId: string
): Promise<Character> {
    const updated = await CharacterService.deleteGreeting(characterId, greetingId);

    characters.set(characterId, updated);
    if (characterId === get(activeCharacterId)) {
        activeCharacter.set(updated);
    }
    return updated;
}

export async function deleteCharacter(characterId: string): Promise<void> {
    const settings = await getAppSettings();

    // Remove from parent's refs
    const existingRefs = settings.characterRefs || [];
    const characterRefs = existingRefs.filter((r) => r.id !== characterId);
    await updateSettings({ characterRefs });

    // Remove record from DB
    try {
        await CharacterService.delete(characterId);
    } catch (error) {
        // If DB delete fails, roll back parent's refs
        await updateSettings({ characterRefs: existingRefs });
        throw error;
    }

    // Update Store
    characters.delete(characterId);
    if (get(activeCharacter)?.id === characterId) {
        clearActiveCharacter();
    }
}

// ─── Character-owned Lorebook CRUD ─────────────────────────────────

export async function createCharacterLorebook(
    characterId: string,
    fields: DeepPartial<LorebookFields>
): Promise<Lorebook> {
    const char = await getCharacter(characterId);

    const lb = await LorebookService.create(characterId, fields);

    const existingRefs = char.lorebookRefs || [];
    const lorebookRefs: OrderedRef[] = [
        ...existingRefs,
        { id: lb.id, sortOrder: generateSortOrder(existingRefs) }
    ];
    try {
        await updateCharacter(characterId, { lorebookRefs });
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

    const existingRefs = char.lorebookRefs || [];
    const lorebookRefs = existingRefs.filter((r) => r.id !== lorebookId);
    await updateCharacter(characterId, { lorebookRefs });

    try {
        await LorebookService.delete(lorebookId);
    } catch (error) {
        await updateCharacter(characterId, { lorebookRefs: existingRefs });
        throw error;
    }

    if (characterId === get(activeCharacterId)) {
        characterLorebooks.delete(lorebookId);
    }
}

// ─── Character-owned Script CRUD ───────────────────────────────────

export async function createCharacterScript(
    characterId: string,
    fields: DeepPartial<ScriptFields>
): Promise<Script> {
    const char = await getCharacter(characterId);

    const sc = await ScriptService.create(characterId, fields);

    const existingRefs = char.scriptRefs || [];
    const scriptRefs: OrderedRef[] = [
        ...existingRefs,
        { id: sc.id, sortOrder: generateSortOrder(existingRefs) }
    ];
    try {
        await updateCharacter(characterId, { scriptRefs });
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

    const existingRefs = char.scriptRefs || [];
    const scriptRefs = existingRefs.filter((r) => r.id !== scriptId);
    await updateCharacter(characterId, { scriptRefs });

    try {
        await ScriptService.delete(scriptId);
    } catch (error) {
        await updateCharacter(characterId, { scriptRefs: existingRefs });
        throw error;
    }

    if (characterId === get(activeCharacterId)) {
        characterScripts.delete(scriptId);
    }
}

// ─── Character-owned CharJS CRUD ───────────────────────────────────

export async function createCharacterCharJS(
    characterId: string,
    fields: DeepPartial<CharJSFields>
): Promise<CharJS> {
    const char = await getCharacter(characterId);
    const cjs = await CharJSService.create(characterId, fields);

    const existingRefs = char.charjsRefs || [];
    const charjsRefs: OrderedRef[] = [
        ...existingRefs,
        { id: cjs.id, sortOrder: generateSortOrder(existingRefs) }
    ];
    try {
        await updateCharacter(characterId, { charjsRefs });
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

    const existingRefs = char.charjsRefs || [];
    const charjsRefs = existingRefs.filter((r) => r.id !== charjsId);
    await updateCharacter(characterId, { charjsRefs });

    try {
        await CharJSService.delete(charjsId);
    } catch (error) {
        await updateCharacter(characterId, { charjsRefs: existingRefs });
        throw error;
    }

    if (characterId === get(activeCharacterId)) {
        characterCharJS.delete(charjsId);
    }
}

// ─── Character-owned Folder & Item Management ──────────────────────

export type CharacterFolderType = 'chats' | 'lorebooks' | 'scripts' | 'modules' | 'charjs';

export async function createCharacterFolder(
    characterId: string,
    folderType: CharacterFolderType,
    name: string,
    parentId?: string
): Promise<FolderDef> {
    const char = await getCharacter(characterId);

    const folders = char.folders ?? {};
    const typeFolders = folders[folderType] ?? [];

    const newFolder = {
        id: generateId(),
        name,
        sortOrder: generateSortOrder(typeFolders as OrderedRef[]),
        parentId
    };

    const updatedFolders = {
        ...folders,
        [folderType]: [...typeFolders, newFolder]
    };

    await updateCharacter(characterId, { folders: updatedFolders });

    return newFolder;
}

export async function updateCharacterFolder(
    characterId: string,
    folderType: CharacterFolderType,
    folderId: string,
    changes: DeepPartial<{ name: string; color: string; parentId: string; sortOrder: string }>
): Promise<void> {
    const char = await getCharacter(characterId);

    const folders = char.folders ?? {};
    const typeFolders = folders[folderType] ?? [];

    const updatedTypeFolders = typeFolders.map((f) =>
        f.id === folderId ? { ...f, ...changes, id: f.id } : f
    );

    const updatedFolders = { ...folders, [folderType]: updatedTypeFolders };

    await updateCharacter(characterId, { folders: updatedFolders });
}

export async function deleteCharacterFolder(
    characterId: string,
    folderType: CharacterFolderType,
    folderId: string
): Promise<void> {
    const char = await getCharacter(characterId);

    const folders = char.folders ?? {};
    const typeFolders = folders[folderType] ?? [];

    const updatedFolders = {
        ...folders,
        [folderType]: typeFolders.filter((f) => f.id !== folderId)
    };

    await updateCharacter(characterId, { folders: updatedFolders });
}

export async function moveCharacterItem(
    characterId: string,
    folderType: CharacterFolderType,
    itemId: string,
    newFolderId?: string,
    newSortOrder?: string
): Promise<void> {
    const char = await getCharacter(characterId);

    let refKey: keyof typeof char;
    switch (folderType) {
        case 'chats':
            refKey = 'chatRefs';
            break;
        case 'lorebooks':
            refKey = 'lorebookRefs';
            break;
        case 'scripts':
            refKey = 'scriptRefs';
            break;
        case 'modules':
            refKey = 'moduleRefs';
            break;
        case 'charjs':
            refKey = 'charjsRefs';
            break;
        default:
            return;
    }

    const refs = (char[refKey] as Array<OrderedRef | ResourceRef>) ?? [];
    const updatedRefs = refs.map((ref) => {
        if (ref.id !== itemId) return ref;
        return {
            ...ref,
            folderId: newFolderId,
            sortOrder: newSortOrder ?? ref.sortOrder,
            id: ref.id
        };
    });

    await updateCharacter(characterId, { [refKey]: updatedRefs });
}
