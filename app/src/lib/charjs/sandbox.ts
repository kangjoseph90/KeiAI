/**
 * Kei API injection into QuickJS sandbox.
 * All APIs are always injected. Low Level APIs check permission at runtime:
 * - If allowLowLevel=true → execute immediately
 * - If allowLowLevel=false → TODO: request permission from user, for now auto-grant
 */

import type { QuickJSAsyncContext } from 'quickjs-emscripten';
import type { CharJSInstance } from './types';
import { createLogger } from '$lib/adapters/logger';
import { emitEvent } from '$lib/events';
import { getChatVariable, setChatVariable } from '$lib/managers';
import { generateId } from '$lib/utils/id';

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
        emitEvent(instance.chatId, event, data).catch(console.error);

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
    injectLowLevelAPIs(ctx, keiObj, instance);

    // ── Mount to global ────────────────────────────────────────
    ctx.setProp(ctx.global, 'KeiAPI', keiObj);
    keiObj.dispose();
}

// ─── Low Level APIs ────────────────────────────────────────────────

function injectLowLevelAPIs(
    ctx: QuickJSAsyncContext,
    keiObj: ReturnType<QuickJSAsyncContext['newObject']>,
    instance: CharJSInstance
): void {
    // TODO: Wire to actual LLM/image handlers
    // TODO: When allowLowLevel=false, show permission request UI to user instead of auto-granting

    async function requirePermission(): Promise<void> {
        if (instance.allowLowLevel) return;
        // TODO: notify user and throw
        // do not edit permission on runtime - edit on explicit user interactions
        // allow low level permission is included in character import - warning ui when importing
    }

    void ctx;
    void keiObj;
    void instance;
    void requirePermission;
}
