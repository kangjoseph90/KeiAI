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

import { emitEvent as charjsEmitEvent } from '$lib/charjs/engine';
import type { EventType, EventName } from './types';

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
	// TODO: Plugin handlers
	await charjsEmitEvent(chatId, event, data);
}
