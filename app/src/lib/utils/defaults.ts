/**
 * Deep-merge utility for applying default values to stored data.
 *
 * Semantics:
 * - Starts with all default values
 * - For each key present in `stored`:
 *   - If both default and stored values are plain objects → recurse
 *   - Otherwise → use stored value (arrays are replaced, not merged)
 * - Keys in defaults but NOT in stored → keep default value
 *
 * This ensures that newly added fields with defaults are always present
 * when reading existing records from the database.
 */

function isPlainObject(val: unknown): val is Record<string, unknown> {
	return val !== null && typeof val === 'object' && !Array.isArray(val);
}

export function applyDefaults<T>(defaults: T, stored: Record<string, unknown>): T {
	const result = { ...defaults } as Record<string, unknown>;

	for (const key of Object.keys(stored)) {
		const storedVal = stored[key];
		const defaultVal = result[key];

		if (isPlainObject(defaultVal) && isPlainObject(storedVal)) {
			result[key] = applyDefaults(defaultVal, storedVal);
		} else {
			result[key] = storedVal;
		}
	}

	return result as T;
}
