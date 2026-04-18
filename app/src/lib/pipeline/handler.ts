import { applyRegexScript } from '$lib/scripts/regex';
import { getMergedScripts } from '$lib/stores';
import { collectCharJSInstances, invokeHandler } from '$lib/charjs';
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
	const instances = await collectCharJSInstances(chatId);

	for (const instance of instances) {
		const registered = instance.pipelineHandlers.get(phase) ?? [];
		for (const h of registered) {
			handlers.push({
				id: `charjs:${instance.charjs.id}:${phase}`,
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
