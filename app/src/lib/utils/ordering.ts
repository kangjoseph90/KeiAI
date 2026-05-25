import type { OrderedRef } from '../types/refs';
import { generateKeyBetween } from 'fractional-indexing';

export function compareSortOrder(a: string | null, b: string | null): number {
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a < b ? -1 : 1;
}

/**
 * Generate a fractional sort order key for appending to the end of a list.
 * Accepts multiple sources (refs, folders, etc.) to ensure uniqueness across
 * all items at the same level.
 */
export function generateSortOrder(
    ...sources: Array<Record<string, { sortOrder: string }> | undefined>
): string {
    const orders: string[] = [];
    for (const source of sources) {
        if (!source) continue;
        for (const item of Object.values(source)) {
            if (item?.sortOrder) orders.push(item.sortOrder);
        }
    }
    if (orders.length === 0) return generateKeyBetween(null, null);
    orders.sort(compareSortOrder);
    return generateKeyBetween(orders[orders.length - 1], null);
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
            return compareSortOrder(aOrder, bOrder);
        }
        if (aOrder !== undefined) return -1;
        if (bOrder !== undefined) return 1;
        return 0;
    });
}
