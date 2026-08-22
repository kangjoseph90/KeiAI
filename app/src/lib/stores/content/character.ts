import { get } from 'svelte/store';
import {
    CharacterService,
    type CharacterFields,
    type CharacterContent,
    type Character,
    type Greeting,
    type Lorebook,
    type Script,
    type CharJS
} from '$lib/services';
import {
    importCharacterPackage as importCharacterPackagePorter,
    type KeiCharacterPackageV1
} from '$lib/porters/character';
import type { PorterProgressReporter } from '$lib/porters/progress';
import type { FolderDef, EntityListConfig } from '$lib/types/refs';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import {
    characters,
    multiRoomCharacters,
    isMultiRoom,
    activeCharacter,
    activeCharacterId,
    activeRoomId
} from '../state';
import { getAppSettings, updateSettings } from './settings';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import type { DeepPartial } from '$lib/utils/defaults';
import type { AssetFields } from '$lib/types/asset';

let characterSelectionVersion = 0;

/**
 * Returns character from store cache first, then from DB if needed.
 * Returns null if not found.
 */
export async function getCharacter(characterId: string): Promise<Character | null> {
    const active = get(activeCharacter);
    if (active?.id === characterId) return active;
    const cached = characters.get(characterId);
    if (cached) return cached;
    const cachedMulti = multiRoomCharacters.get(characterId);
    if (cachedMulti?.scopeId === get(activeRoomId)) return cachedMulti;
    const fetched = await CharacterService.get(characterId);
    if (fetched) {
        if (fetched.scopeType === 'user') {
            characters.set(characterId, fetched);
        } else if (fetched.scopeId === get(activeRoomId)) {
            multiRoomCharacters.set(characterId, fetched);
        }
    }
    return fetched;
}

export async function loadCharacters(): Promise<void> {
    const settings = await getAppSettings();
    const list = await CharacterService.list();
    characters.setAll(sortByRefs(list, settings.characters.refs));
}

export async function selectCharacter(
    characterId: string,
    isContextCurrent: () => boolean = () => true
): Promise<void> {
    if (!isContextCurrent()) return;
    const version = ++characterSelectionVersion;
    clearActiveCharacterState();
    const isCurrent = () => version === characterSelectionVersion && isContextCurrent();

    const character = await getCharacter(characterId);
    if (!isCurrent()) return;
    if (!character) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);

    if (character.scopeType === 'user') {
        characters.set(character.id, character);
    } else if (character.scopeId === get(activeRoomId)) {
        multiRoomCharacters.set(character.id, character);
    }
    activeCharacterId.set(character.id);
}

export function clearActiveCharacter(): void {
    characterSelectionVersion += 1;
    clearActiveCharacterState();
}

function clearActiveCharacterState(): void {
    activeCharacterId.set(null);
}

export async function updateCharacter(
    characterId: string,
    changes: DeepPartial<CharacterFields>
): Promise<void> {
    const updated = await CharacterService.update(characterId, changes);
    if (updated.scopeType === 'user') {
        characters.set(characterId, updated);
    } else if (updated.scopeId === get(activeRoomId)) {
        multiRoomCharacters.set(characterId, updated);
    }
}

export async function updateCharacterContent(
    characterId: string,
    changes: DeepPartial<CharacterContent>
): Promise<void> {
    const updated = await CharacterService.update(characterId, changes);
    if (updated.scopeType === 'user') {
        characters.set(characterId, updated);
    } else if (updated.scopeId === get(activeRoomId)) {
        multiRoomCharacters.set(characterId, updated);
    }
}

export async function createCharacter(
    fields: DeepPartial<CharacterFields> = {}
): Promise<Character> {
    if (get(isMultiRoom)) {
        const character = await CharacterService.create(fields, 'room');
        multiRoomCharacters.set(character.id, character);
        return character;
    }

    const settings = await getAppSettings();

    // Create record in DB
    const character = await CharacterService.create(fields);

    // Add to parent's refs
    const sortOrder = generateSortOrder(settings.characters.refs, settings.characters.folders);
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

export async function importCharacterPackage(
    pkg: KeiCharacterPackageV1,
    options: {
        allowLightAssets?: boolean;
        select?: boolean;
        onProgress?: PorterProgressReporter;
    } = {}
): Promise<Character> {
    const scopeType = get(isMultiRoom) ? 'room' : 'user';
    const characterId = await importCharacterPackagePorter(pkg, {
        scopeType,
        allowLightAssets: options.allowLightAssets,
        onProgress: options.onProgress
    });

    const character = await CharacterService.get(characterId);
    if (!character) {
        throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);
    }

    if (character.scopeType === 'user') {
        const settings = await getAppSettings();
        const sortOrder = generateSortOrder(settings.characters.refs, settings.characters.folders);
        try {
            await updateSettings({
                characters: { refs: { [character.id]: { id: character.id, sortOrder } } }
            });
        } catch (error) {
            await CharacterService.delete(character.id);
            throw error;
        }
        characters.set(character.id, character);
    } else if (character.scopeId === get(activeRoomId)) {
        multiRoomCharacters.set(character.id, character);
    }

    if (options.select) {
        await selectCharacter(character.id);
    }

    return character;
}

export async function updateCharacterAvatar(characterId: string, file: File): Promise<void> {
    const updated = await CharacterService.updateAvatar(characterId, file);
    if (updated.scopeType === 'user') {
        characters.set(characterId, updated);
    } else if (updated.scopeId === get(activeRoomId)) {
        multiRoomCharacters.set(characterId, updated);
    }
}

export async function removeCharacterAvatar(characterId: string): Promise<void> {
    const updated = await CharacterService.removeAvatar(characterId);
    if (updated.scopeType === 'user') {
        characters.set(characterId, updated);
    } else if (updated.scopeId === get(activeRoomId)) {
        multiRoomCharacters.set(characterId, updated);
    }
}

// ─── Character-owned Asset CRUD ────────────────────────────────────

export async function createCharacterAsset(
    characterId: string,
    asset: File | AssetFields
): Promise<void> {
    const char = await getCharacter(characterId);
    if (!char) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);

    const sortOrder = generateSortOrder(char.assets.refs, char.assets.folders);
    const updated = await CharacterService.createAsset(characterId, asset, sortOrder);

    if (updated.scopeType === 'user') {
        characters.set(characterId, updated);
    } else if (updated.scopeId === get(activeRoomId)) {
        multiRoomCharacters.set(characterId, updated);
    }
}

export async function deleteCharacterAsset(characterId: string, assetId: string): Promise<void> {
    const updated = await CharacterService.deleteAsset(characterId, assetId);

    if (updated.scopeType === 'user') {
        characters.set(characterId, updated);
    } else if (updated.scopeId === get(activeRoomId)) {
        multiRoomCharacters.set(characterId, updated);
    }
}

export async function deleteCharacter(characterId: string): Promise<void> {
    const character = await getCharacter(characterId);
    if (character?.scopeType === 'room') {
        await CharacterService.delete(characterId);
        multiRoomCharacters.delete(characterId);
        if (get(activeCharacterId) === characterId) {
            clearActiveCharacter();
        }
        return;
    }

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

// ─── Character-owned resources ─────────────────────────────────────

export async function saveCharacterGreeting(characterId: string, item: Greeting): Promise<void> {
    await updateCharacter(characterId, { greetings: { [item.id]: item } });
}

export async function deleteCharacterGreeting(
    characterId: string,
    greetingId: string
): Promise<void> {
    await updateCharacter(characterId, { greetings: { [greetingId]: undefined } });
}

export async function saveCharacterLorebook(characterId: string, item: Lorebook): Promise<void> {
    await updateCharacter(characterId, { lorebooks: { refs: { [item.id]: item } } });
}

export async function deleteCharacterLorebook(
    characterId: string,
    lorebookId: string
): Promise<void> {
    await updateCharacter(characterId, { lorebooks: { refs: { [lorebookId]: undefined } } });
}

export async function saveCharacterScript(characterId: string, item: Script): Promise<void> {
    await updateCharacter(characterId, { scripts: { refs: { [item.id]: item } } });
}

export async function deleteCharacterScript(characterId: string, scriptId: string): Promise<void> {
    await updateCharacter(characterId, { scripts: { refs: { [scriptId]: undefined } } });
}

export async function saveCharacterCharJS(characterId: string, item: CharJS): Promise<void> {
    await updateCharacter(characterId, { charjs: { refs: { [item.id]: item } } });
}

export async function deleteCharacterCharJS(characterId: string, charjsId: string): Promise<void> {
    await updateCharacter(characterId, { charjs: { refs: { [charjsId]: undefined } } });
}

// ─── Character-owned Folder & Item Management ──────────────────────

export type CharacterFolderType = 'lorebooks' | 'scripts' | 'charjs' | 'assets';

export async function createCharacterFolder(
    characterId: string,
    folderType: CharacterFolderType,
    name: string,
    parentId?: string,
    sortOrder?: string
): Promise<FolderDef> {
    const char = await getCharacter(characterId);
    if (!char) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);

    const newFolder: FolderDef = {
        id: generateId(),
        name,
        sortOrder: sortOrder ?? generateSortOrder(char[folderType].refs, char[folderType].folders),
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
