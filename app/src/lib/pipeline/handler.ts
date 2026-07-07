import { applyRegexScript } from '$lib/pipeline/regex';
import { getMergedScripts } from '$lib/stores';
import { collectCharJSInstances, invokeHandler } from '$lib/charjs';
import { pluginManager } from '$lib/plugins';
import type { PipelinePhase, PipelinePhaseType, PipelineHandler } from './types';
import type { RuntimeContext } from '$lib/types/context';

export async function collectPipelineHandlers<K extends keyof PipelinePhaseType>(
    chatId: string,
    phase: K,
    characterId?: string
): Promise<PipelineHandler<PipelinePhaseType[K], K>[]>;
export async function collectPipelineHandlers<P extends string, T>(
    chatId: string,
    phase: PipelinePhase<P>,
    characterId?: string
): Promise<PipelineHandler<T, P>[]>;
export async function collectPipelineHandlers(
    chatId: string,
    phase: string,
    characterId?: string
): Promise<PipelineHandler<unknown>[]> {
    // ── 1. Regex script handlers ────────────────────────────────
    const regexHandlers = await collectRegexHandlers(chatId, phase, characterId);

    // ── 2. CharJS handlers (character + modules) ────────────────
    const charjsHandlers = await collectCharJSHandlers(chatId, phase, characterId);

    // ── 3. Plugin handlers ─────────────────────────────────────────
    const pluginHandlers = await collectPluginHandlers(phase);

    // ── 4. Merge and sort by order ──────────────────────────────
    return [...regexHandlers, ...charjsHandlers, ...pluginHandlers].sort(
        (a, b) => a.order - b.order
    );
}

async function collectRegexHandlers(
    chatId: string,
    phase: string,
    characterId?: string
): Promise<PipelineHandler<unknown>[]> {
    const scripts = await getMergedScripts(chatId, characterId);
    return scripts
        .filter((s) => s.phase === phase)
        .map((s) => ({
            id: s.id,
            phase: s.phase,
            order: s.order,
            run: async (data: unknown, ctx: RuntimeContext) => {
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
    phase: string,
    characterId?: string
): Promise<PipelineHandler<unknown>[]> {
    const handlers: PipelineHandler<unknown>[] = [];
    const instances = await collectCharJSInstances(chatId, 'pipe', phase, characterId);

    for (const instance of instances) {
        const registered = instance.pipelineHandlers.get(phase) ?? [];
        for (const h of registered) {
            handlers.push({
                id: `charjs:${instance.charjs.id}:${phase}`,
                phase,
                order: h.order,
                run: async (data: unknown, ctx: RuntimeContext) => {
                    const result = await invokeHandler(instance, h.fnHandle, data, ctx);
                    return result !== undefined ? result : data;
                }
            });
        }
    }

    return handlers;
}

async function collectPluginHandlers(
    phase: string
): Promise<Array<PipelineHandler<unknown, string>>> {
    const handlers: Array<PipelineHandler<unknown, string>> = [];
    for (const instance of pluginManager.getInstances()) {
        const pluginHandlers = instance.pipelineHandlers.get(phase) ?? [];
        for (const handler of pluginHandlers) {
            handlers.push({
                id: `plugin:${instance.pluginId}:${handler.fnId}:${phase}`,
                phase,
                order: handler.order,
                run: async (data: unknown, ctx: RuntimeContext) => {
                    const result = await instance.broker.invoke(handler.fnId, [data, ctx]);
                    return result !== undefined ? result : data;
                }
            });
        }
    }

    return handlers;
}
