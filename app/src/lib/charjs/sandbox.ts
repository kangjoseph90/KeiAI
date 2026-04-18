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

export function injectKeiAPI(
	ctx: QuickJSAsyncContext,
	instance: CharJSInstance,
	allowLowLevel: boolean
): void {
	const keiObj = ctx.newObject();
	const logger = createLogger(`charjs:sandbox:${instance.ownerId}:${instance.chatId}`);

	// ── KeiAPI.log(...args) ────────────────────────────────────
	const logFn = ctx.newFunction('log', (...args) => {
		const nativeArgs = args.map((h) => ctx.dump(h));
		logger.info(...nativeArgs);
	});
	ctx.setProp(keiObj, 'log', logFn);
	logFn.dispose();

	// ── KeiAPI.addPipelineHandler(phase, fn, opts?) ────────────────
	const addPipelineHandlerFn = ctx.newFunction('addPipelineHandler', (...args) => {
		const [phaseHandle, fnHandle, optsHandle] = args;
		const phase = ctx.getString(phaseHandle);

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
		instance.pipelineHandlers.get(phase)!.push({ order, fnHandle: dupedFn });
	});
	ctx.setProp(keiObj, 'addPipelineHandler', addPipelineHandlerFn);
	addPipelineHandlerFn.dispose();

	// ── KeiAPI.onEvent(event, fn) ──────────────────────────────
	const onEventFn = ctx.newFunction('onEvent', (...args) => {
		const [eventHandle, fnHandle] = args;
		const event = ctx.getString(eventHandle);

		if (!instance.eventListeners.has(event)) {
			instance.eventListeners.set(event, []);
		}

		const dupedFn = fnHandle.dup();
		instance.eventListeners.get(event)!.push(dupedFn);
	});
	ctx.setProp(keiObj, 'onEvent', onEventFn);
	onEventFn.dispose();

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
	// TODO: Wire to actual ChatVar storage using instance.chatId
	const vars = new Map<string, string>();

	const getVarFn = ctx.newFunction('getVar', (keyHandle) => {
		const key = ctx.getString(keyHandle);
		const value = vars.get(key);
		return value !== undefined ? ctx.newString(value) : ctx.null;
	});
	ctx.setProp(keiObj, 'getVar', getVarFn);
	getVarFn.dispose();

	const setVarFn = ctx.newFunction('setVar', (keyHandle, valueHandle) => {
		const key = ctx.getString(keyHandle);
		const value = ctx.getString(valueHandle);
		vars.set(key, value);
	});
	ctx.setProp(keiObj, 'setVar', setVarFn);
	setVarFn.dispose();

	// ── KeiAPI.getChatId() / KeiAPI.getOwnerId() ───────────────
	const getChatIdFn = ctx.newFunction('getChatId', () => ctx.newString(instance.chatId));
	ctx.setProp(keiObj, 'getChatId', getChatIdFn);
	getChatIdFn.dispose();

	const getOwnerIdFn = ctx.newFunction('getOwnerId', () => ctx.newString(instance.ownerId));
	ctx.setProp(keiObj, 'getOwnerId', getOwnerIdFn);
	getOwnerIdFn.dispose();

	// ── Low Level APIs (runtime permission check) ─────────────
	injectLowLevelAPIs(ctx, keiObj, instance, allowLowLevel);

	// ── Mount to global ────────────────────────────────────────
	ctx.setProp(ctx.global, 'KeiAPI', keiObj);
	keiObj.dispose();
}

// ─── Low Level APIs ────────────────────────────────────────────────

function injectLowLevelAPIs(
	ctx: QuickJSAsyncContext,
	keiObj: ReturnType<QuickJSAsyncContext['newObject']>,
	instance: CharJSInstance,
	allowLowLevel: boolean
): void {
	// TODO: Wire to actual LLM/image handlers
	// TODO: When allowLowLevel=false, show permission request UI to user instead of auto-granting

	async function requirePermission(): Promise<void> {
		if (allowLowLevel) return;
		// TODO: notify user and throw
		// do not edit permission on runtime - edit on explicit user interactions
		// allow low level permission is included in character import - warning ui when importing
	}

	void ctx;
	void keiObj;
	void instance;
	void requirePermission;
}
