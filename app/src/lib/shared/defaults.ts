/**
 * Deep-merge utility.
 *
 * Used for two purposes:
 * 1. Applying defaults to stored data (read path) — fills missing fields
 * 2. Merging partial updates into current data (write path) — preserves sibling keys
 *
 * Semantics:
 * - Starts with all `base` values
 * - For each key present in `overlay`:
 *   - If both are plain objects → recurse
 *   - Otherwise → use overlay value (arrays are replaced, not merged)
 * - Keys in base but NOT in overlay → keep base value
 */

function isPlainObject(val: unknown): val is Record<string, unknown> {
	return val !== null && typeof val === 'object' && !Array.isArray(val);
}

export function deepMerge<T>(base: T, overlay: Record<string, unknown>): T {
	const result = { ...base } as Record<string, unknown>;

	for (const key of Object.keys(overlay)) {
		const overlayVal = overlay[key];
		const baseVal = result[key];

		if (isPlainObject(baseVal) && isPlainObject(overlayVal)) {
			result[key] = deepMerge(baseVal, overlayVal);
		} else {
			result[key] = overlayVal;
		}
	}

	return result as T;
}
