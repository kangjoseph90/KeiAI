/**
 * Kei API injection into QuickJS sandbox.
 * All APIs are always injected. Low Level APIs check permission at runtime:
 * - If allowLowLevel=true → execute immediately
 * - If allowLowLevel=false → notify the user and reject the call
 */

import type { QuickJSAsyncContext } from 'quickjs-emscripten';
import type { CharJSInstance } from './types';
import { createLogger } from '$lib/adapters/logger';
import { emitEvent } from '$lib/events';
import { getChatVariable, setChatVariable } from '$lib/managers';
import { generateId } from '$lib/utils/id';
import { getAppSettings } from '$lib/stores/content/settings';
import { resolveLLMModelConfig, resolveLLMParameters, selectLLMHandler } from '$lib/llm/handler';
import type { LLMMessage } from '$lib/llm/types';
import { getTextContent } from '$lib/workflow/agent/llm';
import { adaptMediaForCapabilities } from '$lib/llm/capabilities';
import { toast } from '$lib/ui';

const DEFAULT_AUX_LLM_TYPE = 'aux';
const DEFAULT_AUX_MAX_RESPONSE = 4096;

export function injectKeiAPI(ctx: QuickJSAsyncContext, instance: CharJSInstance): void {
    const keiObj = ctx.newObject();
    const logger = createLogger(`charjs:sandbox:${instance.charjs.name}`);

    // ── KeiAPI.log(...args) ────────────────────────────────────
    const logFn = ctx.newFunction('log', (...args) => {
        const nativeArgs = args.map((h) => ctx.dump(h));
        logger.info(...nativeArgs);
    });
    ctx.setProp(keiObj, 'log', logFn);
    logFn.dispose();

    // ── KeiAPI.onPipeline(phase, fn, opts?) ────────────────
    const onPipelineFn = ctx.newFunction('onPipeline', (...args) => {
        const [phaseHandle, fnHandle, optsHandle] = args;
        const phase = ctx.getString(phaseHandle);
        const id = generateId();

        let order = 100;
        if (optsHandle) {
            const opts = ctx.dump(optsHandle);
            if (typeof opts === 'object' && opts !== null && 'order' in opts) {
                order = (opts as { order: number }).order;
            }
        }

        if (!instance.pipelineHandlers.has(phase)) {
            instance.pipelineHandlers.set(phase, []);
        }

        // Dup the handle so it survives past evalCodeAsync
        const dupedFn = fnHandle.dup();
        instance.pipelineHandlers.get(phase)!.push({ id, order, fnHandle: dupedFn });

        // Return unregister function
        return ctx.newFunction('unregister', () => {
            const handlers = instance.pipelineHandlers.get(phase);
            if (handlers) {
                const idx = handlers.findIndex((h) => h.id === id);
                if (idx !== -1) {
                    const [removed] = handlers.splice(idx, 1);
                    if (removed.fnHandle.alive) removed.fnHandle.dispose();
                }
            }
        });
    });
    ctx.setProp(keiObj, 'onPipeline', onPipelineFn);
    onPipelineFn.dispose();

    // ── KeiAPI.onEvent(event, fn) ──────────────────────────────
    const onEventFn = ctx.newFunction('onEvent', (...args) => {
        const [eventHandle, fnHandle] = args;
        const event = ctx.getString(eventHandle);
        const id = generateId();

        if (!instance.eventListeners.has(event)) {
            instance.eventListeners.set(event, []);
        }

        const dupedFn = fnHandle.dup();
        instance.eventListeners.get(event)!.push({ id, fnHandle: dupedFn });

        // Return unregister function
        return ctx.newFunction('unregister', () => {
            const listeners = instance.eventListeners.get(event);
            if (listeners) {
                const idx = listeners.findIndex((h) => h.id === id);
                if (idx !== -1) {
                    const [removed] = listeners.splice(idx, 1);
                    if (removed.fnHandle.alive) removed.fnHandle.dispose();
                }
            }
        });
    });
    ctx.setProp(keiObj, 'onEvent', onEventFn);
    onEventFn.dispose();

    // ── KeiAPI.registerMacro(name, fn, opts?) ─────────────────
    const registerMacroFn = ctx.newFunction('registerMacro', (nameHandle, fnHandle, optsHandle) => {
        const name = ctx.getString(nameHandle);

        // Cleanup old handler if exists
        const old = instance.macroHandlers.get(name);
        if (old && old.fnHandle.alive) old.fnHandle.dispose();

        const dupedFn = fnHandle.dup();
        const id = generateId();

        let recursive: boolean | undefined;
        if (optsHandle) {
            const opts = ctx.dump(optsHandle);
            if (typeof opts === 'object' && opts !== null && 'recursive' in opts) {
                recursive = !!opts.recursive;
            }
        }

        instance.macroHandlers.set(name, { id, fnHandle: dupedFn, recursive });

        // Return unregister function
        return ctx.newFunction('unregister', () => {
            const current = instance.macroHandlers.get(name);
            if (current && current.id === id) {
                instance.macroHandlers.delete(name);
                if (current.fnHandle.alive) current.fnHandle.dispose();
            }
        });
    });
    ctx.setProp(keiObj, 'registerMacro', registerMacroFn);
    registerMacroFn.dispose();

    // ── KeiAPI.emitEvent(event, data) ──────────────────────────
    const emitEventFn = ctx.newFunction('emitEvent', (...args) => {
        const [eventHandle, dataHandle] = args;
        const event = ctx.getString(eventHandle);
        const data = dataHandle ? ctx.dump(dataHandle) : undefined;

        // Fire to host asynchronously. do not await to prevent deadlock
        emitEvent(event, { chatId: instance.chatId }, data).catch(console.error);

        return ctx.undefined;
    });
    ctx.setProp(keiObj, 'emitEvent', emitEventFn);
    emitEventFn.dispose();

    // ── KeiAPI.getVar(key) / KeiAPI.setVar(key, value) ─────────
    const getVarFn = ctx.newFunction('getVar', (keyHandle) => {
        const key = ctx.getString(keyHandle);
        const promise = ctx.newPromise();

        getChatVariable(instance.chatId, key)
            .then((val) => {
                promise.resolve(val !== null ? ctx.newString(val) : ctx.null);
            })
            .catch(() => promise.resolve(ctx.null));

        return promise.handle;
    });
    ctx.setProp(keiObj, 'getVar', getVarFn);
    getVarFn.dispose();

    const setVarFn = ctx.newFunction('setVar', (keyHandle, valueHandle) => {
        const key = ctx.getString(keyHandle);
        const value = ctx.getString(valueHandle);
        const promise = ctx.newPromise();

        setChatVariable(instance.chatId, key, value)
            .then(() => promise.resolve(ctx.undefined))
            .catch(() => promise.resolve(ctx.undefined));

        return promise.handle;
    });
    ctx.setProp(keiObj, 'setVar', setVarFn);
    setVarFn.dispose();

    // ── KeiAPI.getChatId() ───────────────
    const getChatIdFn = ctx.newFunction('getChatId', () => ctx.newString(instance.chatId));
    ctx.setProp(keiObj, 'getChatId', getChatIdFn);
    getChatIdFn.dispose();

    // ── Low Level APIs (runtime permission check) ─────────────
    async function requirePermission(): Promise<void> {
        if (instance.allowLowLevel) return;

        toast.error({
            title: 'Low-level access blocked',
            description: `CharJS "${instance.charjs.name}" tried to use a low-level API.`
        });
        throw new Error(`Low-level access is not allowed for CharJS "${instance.charjs.name}"`);
    }

    const callLLMFn = ctx.newFunction('callLLM', (typeHandle, messagesHandle, optionsHandle) => {
        const options = readLLMCallOptions(optionsHandle ? ctx.dump(optionsHandle) : undefined);
        const type = options.type ?? ctx.getString(typeHandle) ?? DEFAULT_AUX_LLM_TYPE;
        const messages = ctx.dump(messagesHandle) as LLMMessage[];
        const promise = ctx.newPromise();

        (async () => {
            await requirePermission();

            const settings = await getAppSettings();
            if (!settings.presetId) {
                throw new Error('No active preset selected');
            }

            const modelConfig = await resolveLLMModelConfig(type, settings.presetId);
            if (!modelConfig) {
                throw new Error(`No model configured for LLM type: ${type}`);
            }

            const selected = selectLLMHandler(modelConfig, settings);
            if (!selected) {
                throw new Error('Failed to create LLM handler');
            }
            const { handler, unsupported = [] } = selected;
            const preparedMessages = adaptMediaForCapabilities(messages, unsupported);

            let content = '';
            for await (const chunk of handler.stream(
                preparedMessages,
                new AbortController().signal,
                {
                    parameters: (await resolveLLMParameters(type, settings.presetId)) ?? {},
                    maxResponse: options.maxResponse ?? DEFAULT_AUX_MAX_RESPONSE,
                    stream: !unsupported.includes('streaming')
                }
            )) {
                content = getTextContent(chunk.parts);
            }

            return content;
        })()
            .then((content) => {
                promise.resolve(ctx.newString(content));
            })
            .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                promise.reject(ctx.newString(message));
            });

        return promise.handle;
    });
    ctx.setProp(keiObj, 'callLLM', callLLMFn);
    callLLMFn.dispose();

    // TODO: Wire image handlers

    // ── Mount to global ────────────────────────────────────────
    ctx.setProp(ctx.global, 'KeiAPI', keiObj);
    keiObj.dispose();
}

function readLLMCallOptions(value: unknown): { type?: string; maxResponse?: number } {
    if (!value || typeof value !== 'object') return {};
    const record = value as Record<string, unknown>;
    return {
        type: typeof record.type === 'string' && record.type.trim() ? record.type : undefined,
        maxResponse:
            typeof record.maxResponse === 'number' && Number.isFinite(record.maxResponse)
                ? record.maxResponse
                : undefined
    };
}
