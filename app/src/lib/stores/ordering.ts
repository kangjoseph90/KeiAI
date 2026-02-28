import type { OrderedRef } from '$lib/db';
import { generateKeyBetween } from 'fractional-indexing';

/** Generate a fractional sort order key for appending to the end of a list */
export function generateSortOrder(existingRefs: OrderedRef[]): string {
	if (existingRefs.length === 0) return generateKeyBetween(null, null);
	const lastOrder = existingRefs[existingRefs.length - 1].sortOrder;
	return generateKeyBetween(lastOrder, null);
}

/** Helper for drag-and-drop to reorder between two existing keys (null means start/end) */
export function reorderKeyBetween(prevKey: string | null, nextKey: string | null): string {
	return generateKeyBetween(prevKey, nextKey);
}

/**
 * Sorts an array of entities based on the sortOrder defined in a corresponding array of OrderedRefs.
 * Entities missing from the refs array are pushed to the end or sorted by ID.
 */
export function sortByRefs<T extends { id: string }>(entities: T[], refs: OrderedRef[]): T[] {
	if (!refs || refs.length === 0) return entities;
	const orderMap = new Map(refs.map((r) => [r.id, r.sortOrder]));
	return [...entities].sort((a, b) => {
		const aOrder = orderMap.get(a.id);
		const bOrder = orderMap.get(b.id);
		if (aOrder !== undefined && bOrder !== undefined) {
			return aOrder.localeCompare(bOrder);
		}
		if (aOrder !== undefined) return -1;
		if (bOrder !== undefined) return 1;
		return 0; // Both undefined, keep original relative order or fallback
	});
}
