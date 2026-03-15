/**
 * Shared Event Emitter for Data Mutations — KeiAI
 *
 * Provides a generic event bus with batched (next-tick) emission.
 * Used by adapters to notify sync engines and UI stores of local changes.
 */

export class WriteEventEmitter<TEvent> {
	private readonly listeners = new Set<(events: TEvent[]) => void>();
	private pendingEvents: TEvent[] = [];
	private flushTimer: ReturnType<typeof setTimeout> | null = null;

	/** Subscribe to events. Returns an unsubscribe function. */
	subscribe(listener: (events: TEvent[]) => void): () => void {
		this.listeners.add(listener);

		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Emit an event.
	 * Events are queued and flushed in a single batch on the next macro-task (setTimeout 0).
	 */
	emit(event: TEvent): void {
		this.pendingEvents.push(event);

		if (this.flushTimer) return;

		this.flushTimer = setTimeout(() => {
			const events = this.pendingEvents;
			this.pendingEvents = [];
			this.flushTimer = null;

			if (this.listeners.size === 0) return;

			for (const listener of this.listeners) {
				listener(events);
			}
		}, 0);
	}
}
