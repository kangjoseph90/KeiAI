/**
 * Ordering Utility Tests
 */

import { describe, it, expect } from 'vitest';
import { generateSortOrder, sortByRefs } from '$lib/shared/ordering';
import type { OrderedRef } from '$lib/shared/types';

describe('Ordering Utilities', () => {
	describe('generateSortOrder', () => {
		it('should generate a key for empty list', () => {
			const result = generateSortOrder([]);
			expect(result).toBeDefined();
			expect(typeof result).toBe('string');
		});

		it('should generate a key after the last item', () => {
			const existing: OrderedRef[] = [
				{ id: '1', sortOrder: 'a0' },
				{ id: '2', sortOrder: 'a1' }
			];
			const result = generateSortOrder(existing);
			expect(result.localeCompare('a1')).toBeGreaterThan(0);
		});
	});

	describe('sortByRefs', () => {
		it('should sort entities according to refs', () => {
			interface TestEntity {
				id: string;
				name: string;
			}
			const entities: TestEntity[] = [
				{ id: 'b', name: 'Item B' },
				{ id: 'a', name: 'Item A' },
				{ id: 'c', name: 'Item C' }
			];
			const refs: OrderedRef[] = [
				{ id: 'a', sortOrder: '1' },
				{ id: 'b', sortOrder: '2' },
				{ id: 'c', sortOrder: '3' }
			];

			const result = sortByRefs(entities, refs);

			expect(result[0].id).toBe('a');
			expect(result[1].id).toBe('b');
			expect(result[2].id).toBe('c');
		});

		it('should handle entities missing from refs by putting them at the end', () => {
			interface TestEntity {
				id: string;
			}
			const entities: TestEntity[] = [{ id: 'missing' }, { id: 'exists' }];
			const refs: OrderedRef[] = [{ id: 'exists', sortOrder: '1' }];

			const result = sortByRefs(entities, refs);

			expect(result[0].id).toBe('exists');
			expect(result[1].id).toBe('missing');
		});

		it('should return original list if refs empty', () => {
			const entities = [{ id: '1' }];
			expect(sortByRefs(entities, [])).toEqual(entities);
		});
	});
});
