import { getOrCreateInstance } from './engine';
import type { CharJSInstance, ModeKind } from './types';
import { getChat } from '$lib/stores/content/chat';
import { getMergedCharJS } from '$lib/stores/content/merged';

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
    mode: string,
    characterId?: string
): Promise<CharJSInstance[]> {
    const chat = await getChat(chatId);
    if (!chat) return [];
    const charjsRequests = await getMergedCharJS(characterId);

    const instances = await Promise.all(
        charjsRequests.map((req) =>
            getOrCreateInstance(chatId, req.charjs, kind, mode, req.allowLowLevel)
        )
    );

    return instances.filter((i): i is CharJSInstance => i !== null);
}
