/**
 * CharJS Engine Pool
 * Manages QuickJS sandbox instances with TTL-based caching.
 * Cache key = `${ownerId}:${chatId}` — each chat gets its own isolated instance.
 */

import { newQuickJSAsyncWASMModuleFromVariant } from 'quickjs-emscripten';
import RELEASE_ASYNC from '@jitl/quickjs-ng-wasmfile-release-asyncify';
import type {
	QuickJSAsyncWASMModule,
	QuickJSAsyncContext,
	QuickJSHandle
} from 'quickjs-emscripten';
import type { CharJS, CharJSInstance } from './types';
import { injectKeiAPI } from './sandbox';
import { Mutex } from '$lib/utils/mutex';
import { createLogger } from '$lib/adapters/logger';

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

const logger = createLogger('charjs:engine');

let wasmModule: QuickJSAsyncWASMModule | null = null;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

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

function destroyInstance(cacheKey: string, instance: CharJSInstance): void {
	// Dispose all pipeline handler handles
	for (const handlers of instance.pipelineHandlers.values()) {
		for (const h of handlers) {
			h.fnHandle.dispose();
		}
	}
	// Dispose all event listener handles
	for (const listeners of instance.eventListeners.values()) {
		for (const h of listeners) {
			h.dispose();
		}
	}
	instance.ctx.dispose();
	instances.delete(cacheKey);
}

export function destroyAllInstances(): void {
	for (const [key, instance] of instances) {
		destroyInstance(key, instance);
	}
	if (cleanupTimer) {
		clearInterval(cleanupTimer);
		cleanupTimer = null;
	}
}

/** Destroy all instances for a specific chat (e.g., when chat is closed). */
export function destroyInstancesByChatId(chatId: string): void {
	for (const [key, instance] of instances) {
		if (instance.chatId === chatId) {
			destroyInstance(key, instance);
		}
	}
}

// ─── Instance Management ───────────────────────────────────────────

async function createInstance(
	ownerId: string,
	chatId: string,
	charjs: CharJS
): Promise<CharJSInstance> {
	const cacheKey = `${ownerId}:${chatId}`;
	const mod = await getWASMModule();
	const runtime = mod.newRuntime();

	// Safety: memory limit
	runtime.setMemoryLimit(MEMORY_LIMIT);

	const ctx = runtime.newContext();

	const instance: CharJSInstance = {
		ownerId,
		chatId,
		code: charjs.code,
		allowLowLevel: charjs.allowLowLevel,
		ctx,
		pipelineHandlers: new Map(),
		eventListeners: new Map(),
		lastAccessed: Date.now(),
		mutex: new Mutex()
	};

	// Inject Kei API based on permissions
	injectKeiAPI(ctx, instance, charjs.allowLowLevel);

	// Safety: interrupt handler for initial evaluation
	const evalStart = Date.now();
	runtime.setInterruptHandler(() => Date.now() - evalStart > EVAL_TIMEOUT_MS);

	// Execute user code — this triggers KeiAPI.pipeline.addHandler() calls
	const result = await ctx.evalCodeAsync(charjs.code);
	if (result.error) {
		const error = ctx.dump(result.error);
		result.error.dispose();
		logger.error(`Error evaluating code for ${cacheKey}:`, error);
		// Still cache the instance — it just has no handlers registered
	} else {
		result.value.dispose();
	}

	// Reset interrupt handler to per-invocation timeout
	runtime.setInterruptHandler(() => false);

	instances.set(cacheKey, instance);
	startInstanceCleanup();
	return instance;
}

/**
 * Get or create a CharJS engine instance.
 * Cache key = `${ownerId}:${chatId}` for chat-scoped isolation.
 * Returns null if charjs has no code.
 */
export async function getOrCreateInstance(
	ownerId: string,
	chatId: string,
	charjs: CharJS
): Promise<CharJSInstance | null> {
	// Skip empty scripts
	if (!charjs.code.trim()) return null;

	const cacheKey = `${ownerId}:${chatId}`;
	const existing = instances.get(cacheKey);

	if (
		existing &&
		existing.code === charjs.code &&
		existing.allowLowLevel === charjs.allowLowLevel
	) {
		existing.lastAccessed = Date.now();
		return existing;
	}

	// Code or permission changed — rebuild
	if (existing) {
		destroyInstance(cacheKey, existing);
	}

	return await createInstance(ownerId, chatId, charjs);
}

/**
 * Invoke a registered QuickJS handler function with host data.
 * Marshals data in via JSON, dumps result out.
 * Returns undefined on error (caller keeps original data).
 */
export async function invokeHandler(
	instance: CharJSInstance,
	fnHandle: ReturnType<CharJSInstance['ctx']['newFunction']>,
	data: unknown
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

		// Call the handler
		const result = await ctx.callFunction(fnHandle, ctx.global, argHandle);
		argHandle.dispose();

		// Reset interrupt handler
		ctx.runtime.setInterruptHandler(() => false);

		if (result.error) {
			const error = ctx.dump(result.error);
			result.error.dispose();
			logger.error(`Handler error for ${instance.ownerId}:`, error);
			return undefined;
		}

		const output = ctx.dump(result.value);
		result.value.dispose();
		return output;
	});
}

/**
 * Emit an event to all CharJS instances for a specific chat.
 * Fire-and-forget: errors are logged but don't propagate.
 */
export async function emitEvent(chatId: string, event: string, data?: unknown): Promise<void> {
	for (const instance of instances.values()) {
		if (instance.chatId !== chatId) continue;

		const listeners = instance.eventListeners.get(event) ?? [];
		for (const listener of listeners) {
			// Fire and forget to prevent deadlock, and use setTimeout (macro-task) to prevent
			// infinite micro-task loops from freezing the browser UI.
			setTimeout(() => {
				invokeHandler(instance, listener, data ?? null).catch((err) => {
					logger.error(`Event '${event}' handler error for ${instance.ownerId}:`, err);
				});
			}, 0);
		}
	}
}
