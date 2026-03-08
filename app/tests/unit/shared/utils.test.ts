/**
 * Utility Tests
 */

import { describe, it, expect } from 'vitest';
import { generateId } from '$lib/shared/id';
import { deepMerge } from '$lib/shared/defaults';

describe('Shared Utilities', () => {
	describe('id (generateId)', () => {
		it('should generate a 15-character string', () => {
			const id = generateId();
			expect(id).toHaveLength(15);
			expect(typeof id).toBe('string');
		});

		it('should use only lowercase letters and digits', () => {
			const id = generateId();
			expect(id).toMatch(/^[a-z0-9]+$/);
		});

		it('should generate unique IDs', () => {
			const id1 = generateId();
			const id2 = generateId();
			expect(id1).not.toBe(id2);
		});
	});

	describe('defaults (deepMerge)', () => {
		it('should merge top-level properties', () => {
			const base = { a: 1, b: 2 };
			const overlay = { b: 3, c: 4 };
			const result = deepMerge(base, overlay);
			expect(result).toEqual({ a: 1, b: 3, c: 4 });
		});

		it('should recursively merge objects', () => {
			const base = { a: { x: 1, y: 2 }, b: 3 };
			const overlay = { a: { y: 10, z: 20 } };
			const result = deepMerge(base, overlay);
			expect(result).toEqual({ a: { x: 1, y: 10, z: 20 }, b: 3 });
		});

		it('should replace arrays instead of merging them', () => {
			const base = { items: [1, 2] };
			const overlay = { items: [3] };
			const result = deepMerge(base, overlay);
			expect(result.items).toEqual([3]);
		});

		it('should handle null values in overlay', () => {
			const base = { a: { b: 1 } };
			const overlay = { a: null } as unknown as Record<string, unknown>;
			const result = deepMerge(base, overlay);
			expect(result.a).toBeNull();
		});
	});
});
