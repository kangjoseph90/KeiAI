import type { AppSettings, Character, Lorebook, Module, Script } from '$lib/services';
import { getChat } from './chat';
import { getCharacter } from './character';
import { getAppSettings } from './settings';
import { getChatLorebooks } from './chat';
import { getCharacterLorebooks, getCharacterScripts } from './character';
import { getModuleLorebooks, getModuleScripts } from './module';
import { getActivePreset, getPresetScripts } from './preset';

/**
 * Returns loaded active modules for a character.
 * Combines globally enabled modules and character-specific enabled modules.
 */
export function getActiveModulesForCharacter(
    character: Character | null | undefined,
    settings: AppSettings | null | undefined,
    moduleList: readonly Module[]
): Module[] {
    const byId = new Map(moduleList.map((module) => [module.id, module]));
    const result: Module[] = [];
    const seen = new Set<string>();

    for (const [id, ref] of Object.entries(settings?.modules.refs ?? {})) {
        if (!ref?.enabled || seen.has(id)) continue;
        const module = byId.get(id);
        if (!module) continue;
        result.push(module);
        seen.add(id);
    }

    for (const [id, ref] of Object.entries(character?.modules.refs ?? {})) {
        if (!ref?.enabled || seen.has(id)) continue;
        const module = byId.get(id);
        if (!module) continue;
        result.push(module);
        seen.add(id);
    }

    return result;
}

/**
 * Returns active module IDs for a character.
 * Combines globally enabled modules and character-specific enabled modules.
 */
export async function getActiveModuleIds(characterId?: string): Promise<Set<string>> {
    const [settings, char] = await Promise.all([
        getAppSettings(),
        characterId ? getCharacter(characterId) : Promise.resolve(null)
    ]);

    const ids = new Set<string>();
    for (const [id, r] of Object.entries(settings.modules.refs)) {
        if (r.enabled) ids.add(id);
    }
    if (char) {
        for (const [id, r] of Object.entries(char.modules.refs)) {
            if (r.enabled) ids.add(id);
        }
    }
    return ids;
}

/**
 * Returns merged lorebooks from chat, character, and active modules.
 * Uses store-cached getters that fall back to refs-based individual gets.
 */
export async function getMergedLorebooks(
    chatId: string,
    characterId?: string
): Promise<Lorebook[]> {
    const chat = await getChat(chatId);
    if (!chat) return [];
    const activeModuleIds = await getActiveModuleIds(characterId);

    const [chatLB, charLB, ...modLBResults] = await Promise.all([
        getChatLorebooks(chatId),
        characterId ? getCharacterLorebooks(characterId) : Promise.resolve([]),
        ...[...activeModuleIds].map((id) => getModuleLorebooks(id))
    ]);

    const modLB = modLBResults.flat();

    return [...modLB, ...charLB, ...chatLB];
}

/**
 * Returns merged scripts from character and active modules.
 * Uses store-cached getters that fall back to refs-based individual gets.
 */
export async function getMergedScripts(chatId: string, characterId?: string): Promise<Script[]> {
    const chat = await getChat(chatId);
    if (!chat) return [];
    const activeModuleIds = await getActiveModuleIds(characterId);
    const activePresetId = getActivePreset()?.id;

    const [charSC, presetSC, ...modSCResults] = await Promise.all([
        characterId ? getCharacterScripts(characterId) : Promise.resolve([]),
        activePresetId ? getPresetScripts(activePresetId) : Promise.resolve([]),
        ...[...activeModuleIds].map((id) => getModuleScripts(id))
    ]);

    const modSC = modSCResults.flat();

    return [...modSC, ...charSC, ...presetSC];
}
