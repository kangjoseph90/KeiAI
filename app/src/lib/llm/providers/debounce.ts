/**
 * Stream Debounce — KeiAI
 *
 * Time-based throttle wrapper for AsyncIterable<StreamContent>.
 * Reduces store/UI update frequency while preserving data integrity.
 *
 * Strategy:
 *   - Leading edge: first chunk yields immediately (UI sees "response started" fast)
 *   - Throttle: skips chunks that arrive within intervalMs of last yield
 *   - Final flush: pending state always yields when source completes
 *   - intervalMs = 0 → passthrough (no throttle)
 */

import type { StreamContent } from '../types';

export interface StreamDebounceConfig {
	/** Minimum ms between yields. 0 = disabled (every chunk). Default: 0 */
	intervalMs?: number;
	/** Yield the first chunk immediately. Default: true */
	leadingEdge?: boolean;
}

/**
 * Wrap an async iterable of StreamContent with time-based throttle.
 * Yields at most once per `intervalMs`, always flushing the final state.
 */
export async function* debounceStream(
	source: AsyncIterable<StreamContent>,
	config?: StreamDebounceConfig
): AsyncIterable<StreamContent> {
	const intervalMs = config?.intervalMs ?? 0;
	const leadingEdge = config?.leadingEdge ?? true;

	// Passthrough when disabled
	if (intervalMs <= 0) {
		yield* source;
		return;
	}

	let lastYieldTime = 0;
	let pending: StreamContent | null = null;
	let isFirst = true;

	for await (const state of source) {
		// Leading edge: yield first chunk immediately
		if (isFirst && leadingEdge) {
			isFirst = false;
			lastYieldTime = Date.now();
			yield state;
			continue;
		}
		isFirst = false;

		const elapsed = Date.now() - lastYieldTime;

		if (elapsed >= intervalMs) {
			lastYieldTime = Date.now();
			pending = null;
			yield state;
		} else {
			// Too soon — buffer latest, skip yield
			pending = state;
		}
	}

	// Final flush: always yield the last state if pending
	if (pending !== null) {
		yield pending;
	}
}
