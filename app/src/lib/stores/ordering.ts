import type { OrderedRef } from "$lib/db";
import { generateKeyBetween } from "fractional-indexing";

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
