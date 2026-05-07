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
import type {
    PipelinePhaseType,
    PipelinePhase,
    PipelineContext,
    PipelineContextType,
    PipelineHandler
} from './types';
import { isSafeMode } from '$lib/config';
export { collectPipelineHandlers };

export async function runPipeline<K extends keyof PipelinePhaseType>(
    chatId: string,
    phase: K,
    data: PipelinePhaseType[K],
    context: PipelineContextType[K]
): Promise<PipelinePhaseType[K]>;
export async function runPipeline<P extends string, T>(
    chatId: string,
    phase: PipelinePhase<P>,
    data: T,
    context?: PipelineContext<P>
): Promise<T>;
export async function runPipeline(
    chatId: string,
    phase: string,
    data: unknown,
    context: PipelineContext = {}
): Promise<unknown> {
    if (isSafeMode()) return data;
    const handlers = await collectPipelineHandlers(chatId, phase);
    return runPipelineHandlers(handlers, data, context);
}

export async function runPipelineHandlers<K extends string, T>(
    handlers: PipelineHandler<T, K>[],
    data: T,
    context: PipelineContext<K>
): Promise<T> {
    let result = data;
    for (const handler of handlers) {
        const next = await handler.run(result, context);
        if (next !== undefined) {
            result = next;
        }
    }
    return result;
}
