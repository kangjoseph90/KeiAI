import type { AppSettings, CharJS, Lorebook, Module, Script } from '$lib/services';
import { getChat } from './chat';
import { getCharacter } from './character';
import { getAppSettings } from './settings';
import { getModule } from './module';
import { getActivePreset } from './preset';
import { listItems } from '$lib/utils/ordering';

/** Returns loaded active modules in global settings order. */
export function selectActiveModules(
    settings: AppSettings | null | undefined,
    moduleList: readonly Module[]
): Module[] {
    if (!settings) return [];
    const byId = new Map(moduleList.map((module) => [module.id, module]));
    return listItems(settings.modules)
        .filter((ref) => ref.enabled)
        .map((ref) => byId.get(ref.id))
        .filter((module): module is Module => module !== undefined);
}

/** Returns active modules from storage in global settings order. */
export async function getActiveModules(): Promise<Module[]> {
    const settings = await getAppSettings();
    const modules = await Promise.all(
        listItems(settings.modules)
            .filter((ref) => ref.enabled)
            .map((ref) => getModule(ref.id))
    );
    return modules.filter((module): module is Module => module !== null);
}

/**
 * Returns merged lorebooks from chat, character, and active modules.
 * Uses store-cached getters that fall back to refs-based individual gets.
 */
export async function getMergedLorebooks(
    chatId: string,
    characterId?: string
): Promise<Lorebook[]> {
    const [chat, character, modules] = await Promise.all([
        getChat(chatId),
        characterId ? getCharacter(characterId) : Promise.resolve(null),
        getActiveModules()
    ]);
    if (!chat) return [];

    const result: Lorebook[] = [];
    for (const module of modules) {
        for (const lorebook of listItems(module.lorebooks)) {
            result.push(lorebook);
        }
    }
    if (character) {
        for (const lorebook of listItems(character.lorebooks)) {
            result.push(lorebook);
        }
    }
    for (const lorebook of listItems(chat.lorebooks)) {
        result.push(lorebook);
    }
    return result;
}

/**
 * Returns merged scripts from character and active modules.
 * Uses store-cached getters that fall back to refs-based individual gets.
 */
export async function getMergedScripts(characterId?: string): Promise<Script[]> {
    const [character, modules] = await Promise.all([
        characterId ? getCharacter(characterId) : Promise.resolve(null),
        getActiveModules()
    ]);
    const preset = getActivePreset();

    const result: Script[] = [];
    for (const module of modules) {
        for (const script of listItems(module.scripts)) {
            result.push(script);
        }
    }
    if (character) {
        for (const script of listItems(character.scripts)) {
            result.push(script);
        }
    }
    if (preset) {
        for (const script of listItems(preset.scripts)) {
            result.push(script);
        }
    }
    return result;
}

export interface MergedCharJS {
    charjs: CharJS;
    allowLowLevel: boolean;
}

/** Returns character and active module CharJS with their owning permission. */
export async function getMergedCharJS(characterId?: string): Promise<MergedCharJS[]> {
    const [character, modules] = await Promise.all([
        characterId ? getCharacter(characterId) : Promise.resolve(null),
        getActiveModules()
    ]);

    const result: MergedCharJS[] = [];
    if (character) {
        for (const charjs of listItems(character.charjs)) {
            result.push({ charjs, allowLowLevel: character.allowLowLevel });
        }
    }
    for (const module of modules) {
        for (const charjs of listItems(module.charjs)) {
            result.push({ charjs, allowLowLevel: module.allowLowLevel });
        }
    }
    return result;
}
