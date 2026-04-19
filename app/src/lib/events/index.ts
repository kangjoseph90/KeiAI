/**
 * Event System
 * Central dispatcher for all app events.
 * Consumers: CharJS sandbox, plugins (future).
 *
 * Built-in events:
 *  message:sent      { content: string }
 *  message:received  { content: string }
 *  chat:started      {}
 *  chat:switched     {}
 *  chat:deleted      {}
 *
 * fire-and-forget - do not wait for finish
 *
 * Type-safe overloads mirror the pipeline system:
 *  emitEvent(chatId, built-in, typed-data)  — compile-time checked
 *  emitEvent(chatId, custom, unknown)        — open for extension
 */

import { collectCharJSInstances, invokeHandler } from '$lib/charjs';
import type { EventType, EventName } from './types';
import { isSafeMode } from '$lib/config';

// ── Built-in events (fully typed) ──────────────────────────────────

export async function emitEvent<K extends keyof EventType>(
	chatId: string,
	event: K,
	data: EventType[K]
): Promise<void>;

// ── Custom events (open extension) ──────────────────────────────────

export async function emitEvent<E extends string>(
	chatId: string,
	event: EventName<E>,
	data?: unknown
): Promise<void>;

// ── Implementation ───────────────────────────────────────────────────

export async function emitEvent(chatId: string, event: string, data?: unknown): Promise<void> {
	if (isSafeMode()) return;

	// TODO: Plugin handlers

	try {
		const instances = await collectCharJSInstances(chatId, 'event', event);

		for (const instance of instances) {
			const listeners = instance.eventListeners.get(event) ?? [];
			for (const listener of listeners) {
				// Fire and forget to prevent deadlock, and use setTimeout (macro-task) to prevent UI freezing
				setTimeout(() => {
					invokeHandler(instance, listener, data ?? null).catch((err) => {
						console.error(
							`Event '${event}' handler error for script ${instance.charjs.name}:`,
							err
						);
					});
				}, 0);
			}
		}
	} catch (error) {
		console.error(`Error emitting event '${event}' for chat ${chatId}:`, error);
	}
}
