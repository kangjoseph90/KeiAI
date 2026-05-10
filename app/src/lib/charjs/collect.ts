import { getOrCreateInstance } from './engine';
import type { CharJSInstance, ModeKind } from './types';
import { getChat } from '$lib/stores/content/chat';
import { getCharacter } from '$lib/stores/content/character';
import { getActiveModuleIds } from '$lib/stores/content/merged';
import { getModule } from '$lib/stores/content/module';
import type { Module } from '$lib/services';

/**
 * Collect all active CharJS instances for a chat + specific mode.
 * Resolves character + module charjs → creates/reuses per-mode instances.
 *
 * @param kind - 'pipe' for pipeline phases, 'event' for event listeners
 * @param mode - the specific phase or event name (e.g. 'output', 'message:sent')
 */
export async function collectCharJSInstances(
    chatId: string,
    kind: ModeKind,
    mode: string
): Promise<CharJSInstance[]> {
    const chat = await getChat(chatId);
    if (!chat) return [];
    const character = await getCharacter(chat.characterId);
    if (!character) return [];
    const activeModuleIds = await getActiveModuleIds(chat.characterId);

    const charjsRequests: Array<{ id: string; allowLowLevel: boolean }> = [];

    charjsRequests.push(
        ...Object.values(character.charjs.refs).map((r) => ({
            id: r.id,
            allowLowLevel: character.allowLowLevel
        }))
    );

    const mods = (await Promise.all([...activeModuleIds].map((id) => getModule(id)))).filter(
        (m): m is Module => m !== null
    );
    for (const mod of mods) {
        charjsRequests.push(
            ...Object.values(mod.charjs.refs).map((r) => ({
                id: r.id,
                allowLowLevel: mod.allowLowLevel
            }))
        );
    }

    const instances = await Promise.all(
        charjsRequests.map((req) =>
            getOrCreateInstance(chatId, req.id, kind, mode, req.allowLowLevel)
        )
    );

    return instances.filter((i): i is CharJSInstance => i !== null);
}
