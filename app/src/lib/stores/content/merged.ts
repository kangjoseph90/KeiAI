import type { Lorebook, Script } from '$lib/services';
import { getChat } from './chat';
import { getCharacter } from './character';
import { getAppSettings } from './settings';
import { getChatLorebooks } from './chat';
import { getCharacterLorebooks, getCharacterScripts } from './character';
import { getModuleLorebooks, getModuleScripts } from './module';

/**
 * Returns active module IDs for a character.
 * Combines globally enabled modules and character-specific enabled modules.
 */
export async function getActiveModuleIds(characterId: string): Promise<Set<string>> {
    const [settings, char] = await Promise.all([getAppSettings(), getCharacter(characterId)]);

    const ids = new Set<string>();
    for (const r of settings.moduleRefs ?? []) {
        if (r.enabled) ids.add(r.id);
    }
    for (const r of char.moduleRefs ?? []) {
        if (r.enabled) ids.add(r.id);
    }
    return ids;
}

/**
 * Returns merged lorebooks from chat, character, and active modules.
 * Uses store-cached getters that fall back to refs-based individual gets.
 */
export async function getMergedLorebooks(chatId: string): Promise<Lorebook[]> {
    const chat = await getChat(chatId);
    const activeModuleIds = await getActiveModuleIds(chat.characterId);

    const [chatLB, charLB, ...modLBResults] = await Promise.all([
        getChatLorebooks(chatId),
        getCharacterLorebooks(chat.characterId),
        ...[...activeModuleIds].map((id) => getModuleLorebooks(id))
    ]);

    const modLB = modLBResults.flat();

    return [...modLB, ...charLB, ...chatLB];
}

/**
 * Returns merged scripts from character and active modules.
 * Uses store-cached getters that fall back to refs-based individual gets.
 */
export async function getMergedScripts(chatId: string): Promise<Script[]> {
    const chat = await getChat(chatId);
    const activeModuleIds = await getActiveModuleIds(chat.characterId);

    const [charSC, ...modSCResults] = await Promise.all([
        getCharacterScripts(chat.characterId),
        ...[...activeModuleIds].map((id) => getModuleScripts(id))
    ]);

    const modSC = modSCResults.flat();

    return [...modSC, ...charSC];
}
