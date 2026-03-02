import { describe, it, expect } from 'vitest';
import { sortByRefs } from './ordering';
import type { OrderedRef } from '$lib/db';

describe('sortByRefs', () => {
	it('returns original entities if refs are empty, null, or undefined', () => {
		const entities = [{ id: '1' }, { id: '2' }];
		expect(sortByRefs(entities, [])).toEqual(entities);
		expect(sortByRefs(entities, null as any)).toEqual(entities);
		expect(sortByRefs(entities, undefined as any)).toEqual(entities);
	});

	it('returns original entities if refs do not match any entity', () => {
		const entities = [{ id: '1' }, { id: '2' }];
		const refs: OrderedRef[] = [{ id: '3', sortOrder: 'a' }];
		expect(sortByRefs(entities, refs)).toEqual(entities);
	});

	it('sorts entities based on sortOrder in refs', () => {
		const entities = [{ id: '1' }, { id: '2' }, { id: '3' }];
		const refs: OrderedRef[] = [
			{ id: '3', sortOrder: 'a' },
			{ id: '1', sortOrder: 'b' },
			{ id: '2', sortOrder: 'c' }
		];
		expect(sortByRefs(entities, refs)).toEqual([{ id: '3' }, { id: '1' }, { id: '2' }]);
	});

	it('pushes entities missing from refs to the end, maintaining relative original order', () => {
		const entities = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }];
		const refs: OrderedRef[] = [
			{ id: '3', sortOrder: 'a' },
			{ id: '1', sortOrder: 'b' }
		];
		// 3 and 1 have order. 2 and 4 don't.
		// Expected order: 3, 1, then 2, 4
		expect(sortByRefs(entities, refs)).toEqual([
			{ id: '3' },
			{ id: '1' },
			{ id: '2' },
			{ id: '4' }
		]);
	});

	it('sorts correctly with fractional or complex sortOrders', () => {
		const entities = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
		const refs: OrderedRef[] = [
			{ id: 'A', sortOrder: 'a1' },
			{ id: 'B', sortOrder: 'a0' },
			{ id: 'C', sortOrder: 'a2' }
		];
		expect(sortByRefs(entities, refs)).toEqual([
			{ id: 'B' }, // 'a0'
			{ id: 'A' }, // 'a1'
			{ id: 'C' } // 'a2'
		]);
	});

	it('does not mutate the original entities array', () => {
		const entities = [{ id: '1' }, { id: '2' }];
		const refs: OrderedRef[] = [
			{ id: '2', sortOrder: 'a' },
			{ id: '1', sortOrder: 'b' }
		];
		const entitiesCopy = [...entities];

		const sorted = sortByRefs(entities, refs);

		expect(sorted).not.toBe(entities);
		expect(entities).toEqual(entitiesCopy);
	});
});
