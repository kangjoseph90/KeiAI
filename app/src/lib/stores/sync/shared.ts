import { get } from 'svelte/store';
import type { EntityStore } from '../entity_store';
import type { OrderedRef } from '$lib/types/refs';
import { sortByRefs } from '$lib/utils/ordering';

export function reorderStoreByRefs<T extends { id: string }>(
    store: EntityStore<T>,
    refs: Record<string, OrderedRef>
): void {
    store.setAll(sortByRefs(get(store), refs));
}

export async function patchEntityStoreByIds<T extends { id: string }>(
    ids: string[],
    store: EntityStore<T>,
    loadById: (id: string) => Promise<T | null>,
    isRelevant?: (item: T) => boolean
): Promise<Map<string, T | null>> {
    const entries = await Promise.all(ids.map(async (id) => [id, await loadById(id)] as const));

    store.batch(() => {
        for (const [id, item] of entries) {
            if (!item || (isRelevant && !isRelevant(item))) {
                store.delete(id);
            } else {
                store.set(id, item);
            }
        }
    });

    return new Map(entries);
}
