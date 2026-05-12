/**
 * Deep-merge utility.
 *
 * Used for two purposes:
 * 1. Applying defaults to stored data (read path) — fills missing fields
 * 2. Merging partial updates into current data (write path) — preserves sibling keys
 *
 * Semantics:
 * - Starts with all `base` values
 * - For each key present in `overlay`：
 *   - If both are plain objects → recurse
 *   - Otherwise → use overlay value (arrays are replaced, not merged)
 * - Keys in base but NOT in overlay → keep base value
 * - If overlay value is undefined → delete the key from base (deletion marker)
 */

function isPlainObject(val: unknown): val is Record<string, unknown> {
    return val !== null && typeof val === 'object' && !Array.isArray(val);
}

export function deepMerge<T>(base: T, overlay?: unknown): T {
    if (!overlay || typeof overlay !== 'object') {
        return base;
    }

    const result = { ...base } as Record<string, unknown>;
    const src = overlay as Record<string, unknown>;

    for (const key of Object.keys(src)) {
        const overlayVal = src[key];
        const baseVal = result[key];

        if (overlayVal === undefined) {
            delete result[key];
        } else if (isPlainObject(baseVal) && isPlainObject(overlayVal)) {
            result[key] = deepMerge(baseVal, overlayVal);
        } else {
            result[key] = overlayVal;
        }
    }

    return result as T;
}

/**
 * Recursive Partial — makes every nested property optional.
 *
 * Use this as the input type for "partial update" functions (e.g. updateSettings)
 * so callers can pass just `{ openai: { apiKey: 'key' } }` without satisfying
 * the entire provider config shape. The read-side types stay strict.
 */
export type DeepPartial<T> = T extends object
    ? {
          [K in keyof T]?: unknown extends T[K]
              ? T[K]
              : NonNullable<T[K]> extends unknown[]
                ? T[K]
                : NonNullable<T[K]> extends object
                  ? DeepPartial<NonNullable<T[K]>>
                  : T[K];
      }
    : T;
