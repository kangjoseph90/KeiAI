import { describe, it, expect } from 'vitest';
import { deepMerge } from '$lib/utils/defaults';

describe('Shared defaults', () => {
	describe('deepMerge', () => {
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

		it('should handle null values in base', () => {
			const base = { a: null };
			const overlay = { a: { b: 1 } } as unknown as Record<string, unknown>;
			const result = deepMerge(base, overlay);
			expect(result.a).toEqual({ b: 1 });
		});

		it('should not mutate the base object', () => {
			const base = { a: { x: 1 } };
			const overlay = { a: { y: 2 } };
			const result = deepMerge(base, overlay);

			expect(result).toEqual({ a: { x: 1, y: 2 } });
			expect(base).toEqual({ a: { x: 1 } });
			expect(base.a).toEqual({ x: 1 });
		});

		it('should overwrite object with primitive', () => {
			const base = { a: { b: 1 } };
			const overlay = { a: 'string' } as unknown as Record<string, unknown>;
			const result = deepMerge(base, overlay);
			expect(result.a).toBe('string');
		});

		it('should overwrite primitive with object', () => {
			const base = { a: 'string' };
			const overlay = { a: { b: 1 } } as unknown as Record<string, unknown>;
			const result = deepMerge(base, overlay);
			expect(result.a).toEqual({ b: 1 });
		});

		it('should overwrite array with object', () => {
			const base = { a: [1, 2, 3] };
			const overlay = { a: { b: 1 } } as unknown as Record<string, unknown>;
			const result = deepMerge(base, overlay);
			expect(result.a).toEqual({ b: 1 });
		});

		it('should overwrite object with array', () => {
			const base = { a: { b: 1 } };
			const overlay = { a: [1, 2, 3] } as unknown as Record<string, unknown>;
			const result = deepMerge(base, overlay);
			expect(result.a).toEqual([1, 2, 3]);
		});
	});
});
