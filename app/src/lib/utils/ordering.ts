import type { OrderedRef } from '../types/refs';
import { generateKeyBetween } from 'fractional-indexing';

/** Generate a fractional sort order key for appending to the end of a list */
export function generateSortOrder(refs: Record<string, OrderedRef> = {}): string {
    const values = Object.values(refs);
    if (values.length === 0) return generateKeyBetween(null, null);
    const lastOrder = values[values.length - 1].sortOrder;
    return generateKeyBetween(lastOrder, null);
}

/**
 * Sorts an array of entities based on the sortOrder defined in a Record of refs.
 * Entities missing from the refs are pushed to the end.
 */
export function sortByRefs<T extends { id: string }>(
    entities: T[],
    refs: Record<string, OrderedRef>
): T[] {
    if (!refs || Object.keys(refs).length === 0) return entities;
    return [...entities].sort((a, b) => {
        const aOrder = refs[a.id]?.sortOrder;
        const bOrder = refs[b.id]?.sortOrder;
        if (aOrder !== undefined && bOrder !== undefined) {
            return aOrder.localeCompare(bOrder);
        }
        if (aOrder !== undefined) return -1;
        if (bOrder !== undefined) return 1;
        return 0;
    });
}
