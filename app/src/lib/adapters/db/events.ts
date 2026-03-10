import type { DatabaseWriteEvent, DatabaseWriteEventListener } from './types';

export class DatabaseWriteEventEmitter {
	private readonly listeners = new Set<DatabaseWriteEventListener>();
	private pendingEvents: DatabaseWriteEvent[] = [];
	private flushTimer: ReturnType<typeof setTimeout> | null = null;

	subscribe(listener: DatabaseWriteEventListener): () => void {
		this.listeners.add(listener);

		return () => {
			this.listeners.delete(listener);
		};
	}

	emit(event: DatabaseWriteEvent): void {
		this.pendingEvents.push(event);

		if (this.flushTimer) return;

		this.flushTimer = setTimeout(() => {
			const events = this.pendingEvents;
			this.pendingEvents = [];
			this.flushTimer = null;

			for (const pendingEvent of events) {
				for (const listener of this.listeners) {
					listener(pendingEvent);
				}
			}
		}, 0);
	}
}