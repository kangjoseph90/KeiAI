/** Adapter-owned metadata: absent on unsaved records, always assigned on persistence. */
export interface LocalUpdateRecord {
    localUpdatedAt?: number;
}

export interface LocalUpdateClock {
    id: 'clock';
    value: number;
}

/** Stable JSON matches persisted state, ignoring object key order and undefined fields. */
export function canonicalJson(value: unknown): string {
    return JSON.stringify(value, (_key, entry: unknown) => {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
            return Object.fromEntries(
                Object.entries(entry).sort(([left], [right]) =>
                    left < right ? -1 : left > right ? 1 : 0
                )
            );
        }
        return entry;
    });
}

export function localRecordChanged<T extends LocalUpdateRecord>(
    before: T | undefined,
    after: T
): boolean {
    if (!before) return true;
    const { localUpdatedAt: _before, ...oldState } = before;
    const { localUpdatedAt: _after, ...newState } = after;
    return canonicalJson(oldState) !== canonicalJson(newState);
}
