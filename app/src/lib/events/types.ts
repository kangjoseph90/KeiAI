/**
 * Event System — Type Definitions
 *
 * Defines all known event names, their payload shapes, and
 * a single unified Listener type.
 *
 * Calling mode is determined by the publisher:
 *   pipe(event, data)  — transform chaining (listeners can modify data)
 *   emit(event, data)  — fan-out notification (return values ignored)
 *
 * Naming convention:
 *   pipe:{action}        — data flows through listeners, each can transform it
 *   {category}:{action}  — fire-and-forget notification
 */

export interface Events {
	// Pipe events
	'pipe:input': { text: string };
	'pipe:output': { text: string };
	'pipe:request': { text: string };
	'pipe:display': { text: string };

	// Generation lifecycle
	'gen:started': { chatId: string };
	'gen:chunk': { chatId: string; chunk: string };
	'gen:completed': { chatId: string; messageId: string };
	'gen:error': { chatId: string; error: string };
	'gen:aborted': { chatId: string; savedPartial: boolean };

	// Chat state
	'chat:selected': { chatId: string };
	'chat:cleared': {};

	// Message state
	'msg:created': { chatId: string; messageId: string };
	'msg:deleted': { chatId: string; messageId: string };

	// Character state
	'char:loaded': { characterId: string };
	'char:unloaded': { characterId: string };

	// Sync
	'sync:complete': { tables: string[] };

	// Session
	'session:initialized': {};
}

// ─── Event Map ─────────────────────────────────────────────

export type EventName = keyof Events;

export type Listener<T = unknown> = (data: T) => T | void | Promise<T | void>;

export interface ListenerEntry {
	fn: Listener;
	priority: number;
	once: boolean;
	ownerId?: string;
}
