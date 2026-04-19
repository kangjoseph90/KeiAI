/**
 * Pipeline System
 * Abstracts all regex scripts, char JS pipeline handlers, plugin pipeline handlers, etc.
 * Operates based on phase.
 * Executes sequentially using the order parameter.
 * <T> -> <T> pipeline. Retains previous value on type mismatch or when undefined is returned.
 * Built-in phases:
 *  input: string
 *  request: string
 *  output: string
 *  display: string
 */

import { collectPipelineHandlers } from './handler';
import type { PhaseType, Phase } from './types';
import { isSafeMode } from '$lib/config';

export async function runPipeline<K extends keyof PhaseType>(
	chatId: string,
	phase: K,
	data: PhaseType[K]
): Promise<PhaseType[K]>;
export async function runPipeline<P extends string, T>(
	chatId: string,
	phase: Phase<P>,
	data: T
): Promise<T>;
export async function runPipeline(chatId: string, phase: string, data: unknown): Promise<unknown> {
	if (isSafeMode()) return data;
	const handlers = await collectPipelineHandlers(chatId, phase);
	let result = data;
	for (const handler of handlers) {
		const next = await handler.run(result);
		if (next !== undefined) {
			result = next;
		}
	}
	return result;
}
