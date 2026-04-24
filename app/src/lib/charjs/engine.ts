/**
 * CharJS Engine Pool
 * Manages QuickJS sandbox instances with TTL-based caching.
 * Cache key = `${charjsId}:${chatId}:${kind}:${mode}` — per-mode isolation for parallelism.
 *
 * Each (script, chat, mode) triple gets its own VM so that different pipeline
 * phases and event handlers never block each other.
 *
 * Handler manifest: on first VM creation for a charjsId, we record every
 * `pipe:<phase>` and `event:<name>` the script registers.  Subsequent calls
 * for unregistered modes skip VM creation entirely.
 */

import { newQuickJSAsyncWASMModuleFromVariant } from 'quickjs-emscripten';
import RELEASE_ASYNC from '@jitl/quickjs-ng-wasmfile-release-asyncify';
import type {
    QuickJSAsyncWASMModule,
    QuickJSAsyncContext,
    QuickJSHandle
} from 'quickjs-emscripten';
import type { CharJSInstance, ModeKind } from './types';
import type { CharJS } from '$lib/services/content/charjs';
import { injectKeiAPI } from './sandbox';
import { Mutex } from '$lib/utils/mutex';
import { createLogger } from '$lib/adapters/logger';
import { CharJSService } from '$lib/services/content/charjs';

// ─── Safe Marshaling ───────────────────────────────────────────────

/**
 * Safely convert host data to a QuickJS handle via JSON.parse.
 * Unlike evalCode(`(${json})`), this cannot be exploited for code injection
 * because the JSON string is passed as a proper string handle, not source code.
 */
function jsonToHandle(ctx: QuickJSAsyncContext, data: unknown): QuickJSHandle | null {
    const jsonStr = JSON.stringify(data);
    const strHandle = ctx.newString(jsonStr);
    const jsonObj = ctx.getProp(ctx.global, 'JSON');
    const parseFn = ctx.getProp(jsonObj, 'parse');
    const result = ctx.callFunction(parseFn, jsonObj, strHandle);
    strHandle.dispose();
    parseFn.dispose();
    jsonObj.dispose();
    if (result.error) {
        result.error.dispose();
        return null;
    }
    return result.value;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
const MEMORY_LIMIT = 16 * 1024 * 1024; // 16MB per instance
const EVAL_TIMEOUT_MS = 5000; // 5s for initial code evaluation
const HANDLER_TIMEOUT_MS = 3000; // 3s per handler invocation

const instances = new Map<string, CharJSInstance>();
const pendingInstances = new Map<string, Promise<CharJSInstance | null>>();

/**
 * Handler manifest — records which `kind:mode` strings a script actually
 * registered handlers for during its first evalCodeAsync.  Keyed by charjsId.
 * `null` value means "probe pending" (another call is building the manifest).
 */
const handlerManifest = new Map<string, Set<string>>();

const logger = createLogger('charjs:engine');

let wasmModule: QuickJSAsyncWASMModule | null = null;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

// ─── Cache Key ──────────────────────────────────────────────────────
function cacheKey(charjsId: string, chatId: string, kind: ModeKind, mode: string): string {
    return `${charjsId}:${chatId}:${kind}:${mode}`;
}

// ─── WASM Module Loading (lazy, one-time) ──────────────────────────

async function getWASMModule(): Promise<QuickJSAsyncWASMModule> {
    if (!wasmModule) {
        wasmModule = await newQuickJSAsyncWASMModuleFromVariant(RELEASE_ASYNC);
    }
    return wasmModule;
}

// ─── Lifecycle ─────────────────────────────────────────────────────

function startInstanceCleanup(): void {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(evictInstances, CLEANUP_INTERVAL_MS);
}

function evictInstances(): void {
    const now = Date.now();
    for (const [key, instance] of instances) {
        if (now - instance.lastAccessed > TTL_MS) {
            destroyInstance(key, instance);
        }
    }
}

function destroyInstance(key: string, instance: CharJSInstance): void {
    try {
        for (const handlers of instance.pipelineHandlers.values()) {
            for (const h of handlers) {
                if (h.fnHandle.alive) h.fnHandle.dispose();
            }
        }
        for (const listeners of instance.eventListeners.values()) {
            for (const h of listeners) {
                if (h.alive) h.dispose();
            }
        }
        if (instance.ctx.alive) instance.ctx.dispose();
        if (instance.runtime.alive) instance.runtime.dispose();
    } catch (err) {
        logger.warn(`Error during QuickJS dispose:`, err);
    } finally {
        instances.delete(key);
    }
}

export function destroyAllInstances(): void {
    for (const [key, instance] of instances) {
        destroyInstance(key, instance);
    }
    handlerManifest.clear();
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }
}

// ─── Instance Management ───────────────────────────────────────────

async function createInstance(
    chatId: string,
    charjs: CharJS,
    kind: ModeKind,
    mode: string,
    allowLowLevel: boolean
): Promise<CharJSInstance> {
    const key = cacheKey(charjs.id, chatId, kind, mode);
    const mod = await getWASMModule();
    const runtime = mod.newRuntime();

    // Safety: memory limit
    runtime.setMemoryLimit(MEMORY_LIMIT);

    const ctx = runtime.newContext();

    const instance: CharJSInstance = {
        charjs,
        chatId,
        mode: `${kind}:${mode}`,
        allowLowLevel,
        runtime,
        ctx,
        pipelineHandlers: new Map(),
        eventListeners: new Map(),
        lastAccessed: Date.now(),
        mutex: new Mutex()
    };

    // Inject Kei API based on permissions
    injectKeiAPI(ctx, instance);

    // Safety: interrupt handler for initial evaluation
    const evalStart = Date.now();
    runtime.setInterruptHandler(() => Date.now() - evalStart > EVAL_TIMEOUT_MS);

    // Execute user code — this triggers KeiAPI.onPipeline() / KeiAPI.onEvent() calls
    const result = await ctx.evalCodeAsync(charjs.code);
    if (result.error) {
        const error = ctx.dump(result.error);
        result.error.dispose();
        logger.error(`Error evaluating code for script '${charjs.name}':`, error);
    } else {
        result.value.dispose();
    }

    // Reset interrupt handler to per-invocation timeout
    runtime.setInterruptHandler(() => false);

    // ── Build handler manifest on first instance for this charjsId ──
    if (!handlerManifest.has(charjs.id)) {
        const modes = new Set<string>();
        for (const phase of instance.pipelineHandlers.keys()) {
            modes.add(`pipe:${phase}`);
        }
        for (const event of instance.eventListeners.keys()) {
            modes.add(`event:${event}`);
        }
        handlerManifest.set(charjs.id, modes);
    }

    instances.set(key, instance);
    startInstanceCleanup();
    return instance;
}

/**
 * Get or create a CharJS engine instance for a specific mode.
 * Cache key = `${charjsId}:${chatId}:${kind}:${mode}` for per-mode isolation.
 *
 * Fast-path: if the handler manifest already knows this script never
 * registers a handler for `kind:mode`, skip VM creation entirely.
 */
export async function getOrCreateInstance(
    chatId: string,
    charjsId: string,
    kind: ModeKind,
    mode: string,
    allowLowLevel: boolean
): Promise<CharJSInstance | null> {
    // ── Manifest fast-path: skip modes this script never registers ───
    const manifest = handlerManifest.get(charjsId);
    if (manifest && !manifest.has(`${kind}:${mode}`)) {
        return null;
    }

    const key = cacheKey(charjsId, chatId, kind, mode);
    const existing = instances.get(key);

    if (existing) {
        if (existing.allowLowLevel !== allowLowLevel) {
            destroyInstance(key, existing);
        } else {
            existing.lastAccessed = Date.now();
            return existing;
        }
    }

    const pending = pendingInstances.get(key);
    if (pending) return pending;

    // Cache miss — fetch data and create
    const promise = (async () => {
        try {
            const charjs = await CharJSService.get(charjsId);
            if (!charjs || !charjs.enabled || !charjs.code.trim()) {
                return null;
            }
            const instance = await createInstance(chatId, charjs, kind, mode, allowLowLevel);

            // Post-creation check: if the manifest now shows no handler
            // for this mode, destroy immediately and return null.
            const hasHandler =
                kind === 'pipe'
                    ? (instance.pipelineHandlers.get(mode)?.length ?? 0) > 0
                    : (instance.eventListeners.get(mode)?.length ?? 0) > 0;

            if (!hasHandler) {
                destroyInstance(key, instance);
                return null;
            }

            return instance;
        } finally {
            pendingInstances.delete(key);
        }
    })();

    pendingInstances.set(key, promise);
    return promise;
}

/**
 * Invoke a registered QuickJS handler function with host data.
 * Marshals data in via JSON, dumps result out.
 * Returns undefined on error (caller keeps original data).
 */
export async function invokeHandler(
    instance: CharJSInstance,
    fnHandle: ReturnType<CharJSInstance['ctx']['newFunction']>,
    data: unknown,
    context?: unknown
): Promise<unknown | undefined> {
    return instance.mutex.runExclusive(async () => {
        const ctx = instance.ctx;

        // Safety: per-invocation timeout
        const invokeStart = Date.now();
        ctx.runtime.setInterruptHandler(() => Date.now() - invokeStart > HANDLER_TIMEOUT_MS);

        // Marshal host data → QuickJS via safe JSON.parse (not evalCode!)
        const argHandle = jsonToHandle(ctx, data);
        if (!argHandle) {
            ctx.runtime.setInterruptHandler(() => false);
            return undefined;
        }

        const args: QuickJSHandle[] = [argHandle];

        // Optionally marshal context
        if (context !== undefined) {
            const contextHandle = jsonToHandle(ctx, context);
            if (contextHandle) {
                args.push(contextHandle);
            }
        }

        // Call the handler
        const result = await ctx.callFunction(fnHandle, ctx.global, ...args);

        // Dispose handles
        for (const h of args) {
            h.dispose();
        }

        // Reset interrupt handler
        ctx.runtime.setInterruptHandler(() => false);

        if (result.error) {
            const error = ctx.dump(result.error);
            result.error.dispose();
            logger.error(`Handler error for ${instance.charjs.name}:`, error);
            return undefined;
        }

        const output = ctx.dump(result.value);
        result.value.dispose();
        return output;
    });
}

// ─── Auto Invalidation ───────────────────────────────────────────────

CharJSService.onChange((id) => {
    // Invalidate manifest so next access re-probes registered handlers
    handlerManifest.delete(id);

    const prefix = `${id}:`;
    for (const [key, instance] of instances.entries()) {
        if (key.startsWith(prefix)) {
            destroyInstance(key, instance);
        }
    }
});
