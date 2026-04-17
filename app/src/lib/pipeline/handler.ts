import { applyRegexScript } from '$lib/scripts/regex';
import { getMergedScripts } from '$lib/stores';
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
	const scripts = await getMergedScripts(chatId);
	const scriptHandlers = scripts
		.filter((s) => s.phase === phase)
		.map((s) => {
			return {
				id: s.id,
				phase: s.phase,
				order: s.order,
				run: async (data: unknown) => {
					// Regex handlers only execute safely when data is a string
					if (typeof data === 'string') {
						return await applyRegexScript(s, data);
					}
					return data;
				}
			};
		});

	// TODO: QuickJS handlers, Plugin Handlers
	return scriptHandlers;
}
