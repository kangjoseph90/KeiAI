/**
 * EventBus — Unified Event System
 *
 * Single global event bus with two calling modes:
 *
 *   pipe(event, data)  — Transform chaining. Each listener receives the previous
 *                        listener's return value. Used for data transformation
 *                        (pipe:input, pipe:output, etc.)
 *
 *   emit(event, data)  — Fan-out notification. All listeners execute independently.
 *                        Return values are ignored. Used for system events
 *                        (chat:selected, gen:completed, etc.)
 *
 * Listeners are always registered with on() and removed with off().
 * The calling mode is determined by the publisher, not the subscriber.
 */

import type {
	Events,
	EventName,
	Listener,
	ListenerEntry
} from './types.js';

// ─── EventBus ───────────────────────────────────────────────────────

class EventBusImpl {
	private listeners = new Map<string, ListenerEntry[]>();

	/**
	 * Register a listener for an event.
	 * Lower priority numbers execute first.
	 */
	on<E extends EventName>(
		event: E,
		fn: Listener<Events[E]>,
		options: { priority?: number; ownerId?: string } = {}
	): void {
		const entry: ListenerEntry = {
			fn: fn as Listener,
			priority: options.priority ?? 100,
			once: false,
			ownerId: options.ownerId
		};
		this.addEntry(event, entry);
	}

	/**
	 * Register a one-time listener. Automatically removed after first invocation.
	 */
	once<E extends EventName>(
		event: E,
		fn: Listener<Events[E]>,
		options: { priority?: number; ownerId?: string } = {}
	): void {
		const entry: ListenerEntry = {
			fn: fn as Listener,
			priority: options.priority ?? 100,
			once: true,
			ownerId: options.ownerId
		};
		this.addEntry(event, entry);
	}

	/**
	 * Remove a specific listener.
	 */
	off(event: string, fn: Listener): void {
		const entries = this.listeners.get(event);
		if (!entries) return;
		const filtered = entries.filter((e) => e.fn !== fn);
		if (filtered.length === 0) {
			this.listeners.delete(event);
		} else {
			this.listeners.set(event, filtered);
		}
	}

	/**
	 * Remove all listeners registered with a given ownerId.
	 * Called when a character or module is unloaded.
	 */
	offByOwner(ownerId: string): void {
		for (const [event, entries] of this.listeners) {
			const filtered = entries.filter((e) => e.ownerId !== ownerId);
			if (filtered.length === 0) {
				this.listeners.delete(event);
			} else {
				this.listeners.set(event, filtered);
			}
		}
	}

	/**
	 * Transform chaining — each listener can modify data, passed to the next.
	 * If a listener returns void/undefined, the previous value passes through.
	 */
	async pipe<E extends EventName>(
		event: E,
		data: Events[E]
	): Promise<Events[E]> {
		const entries = this.listeners.get(event);
		if (!entries || entries.length === 0) return data;

		let result = data;
		const toRemove: Listener[] = [];

		for (const entry of entries) {
			const returned = await entry.fn(result);
			if (returned !== undefined && returned !== null) {
				result = returned as Events[E];
			}
			if (entry.once) toRemove.push(entry.fn);
		}

		for (const fn of toRemove) this.off(event, fn);
		return result;
	}

	/**
	 * Fan-out notification — all listeners execute independently.
	 * Return values are ignored. Errors are caught and logged.
	 */
	async emit<E extends EventName>(
		event: E,
		data: Events[E]
	): Promise<void> {
		if (event.startsWith('pipe:')) {
			console.warn(
				`[EventBus] "${event}" is a pipe event — use pipe() instead of emit()`
			);
		}

		const entries = this.listeners.get(event);
		if (!entries || entries.length === 0) return;

		const toRemove: Listener[] = [];

		for (const entry of entries) {
			try {
				await entry.fn(data);
			} catch (error) {
				console.error(`[EventBus] Error in listener for "${event}":`, error);
			}
			if (entry.once) toRemove.push(entry.fn);
		}

		for (const fn of toRemove) this.off(event, fn);
	}

	/**
	 * Check if an event has any registered listeners.
	 */
	has(event: string): boolean {
		return (this.listeners.get(event)?.length ?? 0) > 0;
	}

	/**
	 * Get the number of listeners for an event.
	 */
	listenerCount(event: string): number {
		return this.listeners.get(event)?.length ?? 0;
	}

	/**
	 * Remove all listeners. Used in testing or full reset.
	 */
	clear(): void {
		this.listeners.clear();
	}

	// ─── Internal ───────────────────────────────────────────────────

	private addEntry(event: string, entry: ListenerEntry): void {
		const existing = this.listeners.get(event) ?? [];
		existing.push(entry);
		// Sort by priority (lower = earlier). Stable sort preserves insertion order for equal priorities.
		existing.sort((a, b) => a.priority - b.priority);
		this.listeners.set(event, existing);
	}
}

// ─── Singleton ──────────────────────────────────────────────────────

/** Global event bus instance. Import this everywhere. */
export const eventBus = new EventBusImpl();
