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
import type { PipelineHandler, PipelinePhase, PipelinePhaseType } from './types';
import { isSafeMode } from '$lib/config';
export { collectPipelineHandlers };
import { createLogger } from '$lib/adapters/logger';
import type { RuntimeContext } from '$lib/types/context';

const logger = createLogger('pipeline');

export async function runPipeline<K extends keyof PipelinePhaseType>(
    phase: K,
    ctx: RuntimeContext,
    data: PipelinePhaseType[K]
): Promise<PipelinePhaseType[K]>;
export async function runPipeline<P extends string, T>(
    phase: PipelinePhase<P>,
    ctx: RuntimeContext,
    data: T
): Promise<T>;
export async function runPipeline(
    phase: string,
    ctx: RuntimeContext,
    data: unknown
): Promise<unknown> {
    if (isSafeMode()) return data;
    const handlers = await collectPipelineHandlers(phase, ctx);
    return runPipelineHandlers(handlers, data, ctx);
}

export async function runPipelineHandlers<K extends string, T>(
    handlers: PipelineHandler<T, K>[],
    data: T,
    ctx: RuntimeContext
): Promise<T> {
    if (isSafeMode()) return data;
    let result = data;
    for (const handler of handlers) {
        try {
            const next = await handler.run(result, ctx);
            if (next !== undefined) {
                if (isSameType(result, next)) {
                    result = next;
                } else {
                    logger.warn(
                        `Type mismatch in pipeline. Expected ${getTypeName(result)}, got ${getTypeName(next)}. Skipping update.`
                    );
                }
            }
        } catch (err) {
            logger.error(`Error in pipeline:`, err);
        }
    }
    return result;
}

function isSameType(a: unknown, b: unknown): boolean {
    if (Array.isArray(a)) return Array.isArray(b);
    if (a === null) return b === null;
    if (typeof a === 'object') return typeof b === 'object' && b !== null && !Array.isArray(b);
    return typeof a === typeof b;
}

function getTypeName(val: unknown): string {
    if (Array.isArray(val)) return 'array';
    if (val === null) return 'null';
    return typeof val;
}
