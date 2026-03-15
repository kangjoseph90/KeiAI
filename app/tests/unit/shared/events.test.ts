import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WriteEventEmitter } from '$lib/utils/events';

interface TestEvent {
	id: string;
	data: string;
}

class TestEventEmitter extends WriteEventEmitter<TestEvent> {}

describe('WriteEventEmitter', () => {
	let emitter: TestEventEmitter;

	beforeEach(() => {
		vi.useFakeTimers();
		emitter = new TestEventEmitter();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('should allow subscription and emission', () => {
		const listener = vi.fn();
		emitter.subscribe(listener);

		const event: TestEvent = { id: '1', data: 'test' };
		emitter.emit(event);

		// Should not be called yet due to next-tick batching
		expect(listener).not.toHaveBeenCalled();

		// Fast-forward timers
		vi.runAllTimers();

		expect(listener).toHaveBeenCalledWith([event]);
	});

	it('should batch multiple emissions in the same tick', () => {
		const listener = vi.fn();
		emitter.subscribe(listener);

		const event1: TestEvent = { id: '1', data: 'a' };
		const event2: TestEvent = { id: '2', data: 'b' };
		const event3: TestEvent = { id: '3', data: 'c' };

		emitter.emit(event1);
		emitter.emit(event2);
		emitter.emit(event3);

		expect(listener).not.toHaveBeenCalled();

		vi.runAllTimers();

		expect(listener).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalledWith([event1, event2, event3]);
	});

	it('should allow multiple independent subscribers', () => {
		const listener1 = vi.fn();
		const listener2 = vi.fn();

		emitter.subscribe(listener1);
		emitter.subscribe(listener2);

		const event: TestEvent = { id: '1', data: 'test' };
		emitter.emit(event);

		vi.runAllTimers();

		expect(listener1).toHaveBeenCalledWith([event]);
		expect(listener2).toHaveBeenCalledWith([event]);
	});

	it('should allow unsubscription', () => {
		const listener = vi.fn();
		const unsubscribe = emitter.subscribe(listener);

		unsubscribe();

		emitter.emit({ id: '1', data: 'test' });
		vi.runAllTimers();

		expect(listener).not.toHaveBeenCalled();
	});

	it('should separate events between different emitter instances', () => {
		const emitter1 = new TestEventEmitter();
		const emitter2 = new TestEventEmitter();
		const listener1 = vi.fn();
		const listener2 = vi.fn();

		emitter1.subscribe(listener1);
		emitter2.subscribe(listener2);

		const event1 = { id: '1', data: 'e1' };
		const event2 = { id: '2', data: 'e2' };

		emitter1.emit(event1);
		emitter2.emit(event2);

		vi.runAllTimers();

		expect(listener1).toHaveBeenCalledWith([event1]);
		expect(listener1).not.toHaveBeenCalledWith([event2]);

		expect(listener2).toHaveBeenCalledWith([event2]);
		expect(listener2).not.toHaveBeenCalledWith([event1]);
	});

	it('should not emit if no events were added', () => {
		const listener = vi.fn();
		emitter.subscribe(listener);

		vi.runAllTimers();

		expect(listener).not.toHaveBeenCalled();
	});

	it('should clear pending events after emission', () => {
		const listener = vi.fn();
		emitter.subscribe(listener);

		emitter.emit({ id: '1', data: 'a' });
		vi.runAllTimers();
		expect(listener).toHaveBeenCalledTimes(1);

		emitter.emit({ id: '2', data: 'b' });
		vi.runAllTimers();
		expect(listener).toHaveBeenCalledTimes(2);
		expect(listener).toHaveBeenLastCalledWith([{ id: '2', data: 'b' }]);
	});
});
