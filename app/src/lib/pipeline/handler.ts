import { applyRegexScript } from '$lib/scripts/regex';
import { getMergedScripts } from '$lib/stores';
import { getOrCreateInstance, invokeHandler } from '$lib/charjs';
import { getChatDetail } from '$lib/stores/content/chat';
import { getCharacterDetail } from '$lib/stores/content/character';
import { getActiveModuleIds } from '$lib/stores/content/merged';
import { getModule } from '$lib/stores/content/module';
import type { CharJS } from '$lib/charjs';
import type { Phase, PhaseType, PipelineHandler } from './types';

export async function collectPipelineHandlers<K extends keyof PhaseType>(
	chatId: string,
	phase: K
): Promise<PipelineHandler<PhaseType[K]>[]>;
export async function collectPipelineHandlers<P extends string, T>(
	chatId: string,
	phase: Phase<P>
): Promise<PipelineHandler<T>[]>;
export async function collectPipelineHandlers(
	chatId: string,
	phase: string
): Promise<PipelineHandler<unknown>[]> {
	// ── 1. Regex script handlers ────────────────────────────────
	const regexHandlers = await collectRegexHandlers(chatId, phase);

	// ── 2. CharJS handlers (character + modules) ────────────────
	const charjsHandlers = await collectCharJSHandlers(chatId, phase);

	// ── 3. Merge and sort by order ──────────────────────────────
	return [...regexHandlers, ...charjsHandlers].sort((a, b) => a.order - b.order);
}

async function collectRegexHandlers(
	chatId: string,
	phase: string
): Promise<PipelineHandler<unknown>[]> {
	const scripts = await getMergedScripts(chatId);
	return scripts
		.filter((s) => s.phase === phase)
		.map((s) => ({
			id: s.id,
			phase: s.phase,
			order: s.advanced ? s.order : 100,
			run: async (data: unknown) => {
				// Regex handlers only execute safely when data is a string
				if (typeof data === 'string') {
					return await applyRegexScript(s, data);
				}
				return data;
			}
		}));
}

// ─── CharJS Collection ─────────────────────────────────────────────

async function collectCharJSHandlers(
	chatId: string,
	phase: string
): Promise<PipelineHandler<unknown>[]> {
	const handlers: PipelineHandler<unknown>[] = [];

	const chat = await getChatDetail(chatId);
	const character = await getCharacterDetail(chat.characterId);
	const activeModuleIds = await getActiveModuleIds(chat.characterId);

	// Collect charjs sources: character + active modules
	const sources: Array<{ ownerId: string; charjs: CharJS }> = [];

	if (character.data.charjs.code) {
		sources.push({ ownerId: character.id, charjs: character.data.charjs });
	}

	const modules = await Promise.all([...activeModuleIds].map((id) => getModule(id)));
	for (const mod of modules) {
		if (mod.charjs.code) {
			sources.push({ ownerId: mod.id, charjs: mod.charjs });
		}
	}

	// Get or create instances and collect handlers for this phase
	for (const { ownerId, charjs } of sources) {
		const instance = await getOrCreateInstance(ownerId, chatId, charjs);
		if (!instance) continue;

		const registered = instance.pipelineHandlers.get(phase) ?? [];
		for (const h of registered) {
			handlers.push({
				id: `charjs:${ownerId}:${phase}`,
				phase,
				order: h.order,
				run: async (data: unknown) => {
					const result = await invokeHandler(instance, h.fnHandle, data);
					return result !== undefined ? result : data;
				}
			});
		}
	}

	return handlers;
}
