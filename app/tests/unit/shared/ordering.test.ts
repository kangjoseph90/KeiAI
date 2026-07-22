/**
 * Ordering Utility Tests
 */

import { describe, it, expect } from 'vitest';
import { generateSortOrder, listItems, sortByRefs } from '$lib/utils/ordering';
import type { OrderedRef } from '$lib/types/refs';

describe('Ordering Utilities', () => {
    describe('generateSortOrder', () => {
        it('should generate a key for empty record', () => {
            const result = generateSortOrder({});
            expect(result).toBeDefined();
            expect(typeof result).toBe('string');
        });

        it('should generate a key after the last item', () => {
            const existing: Record<string, OrderedRef> = {
                '1': { id: '1', sortOrder: 'a0' },
                '2': { id: '2', sortOrder: 'a1' }
            };
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
            const refs: Record<string, OrderedRef> = {
                a: { id: 'a', sortOrder: '1' },
                b: { id: 'b', sortOrder: '2' },
                c: { id: 'c', sortOrder: '3' }
            };

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
            const refs: Record<string, OrderedRef> = { exists: { id: 'exists', sortOrder: '1' } };

            const result = sortByRefs(entities, refs);

            expect(result[0].id).toBe('exists');
            expect(result[1].id).toBe('missing');
        });

        it('should return original list if refs empty', () => {
            const entities = [{ id: '1' }];
            expect(sortByRefs(entities, {})).toEqual(entities);
        });
    });

    describe('listItems', () => {
        it('returns owned items by sort order without mutating the config', () => {
            const refs = {
                second: { id: 'second', sortOrder: 'b', name: 'Second' },
                first: { id: 'first', sortOrder: 'a', name: 'First' }
            };

            expect(listItems({ refs, folders: {} }).map((item) => item.id)).toEqual([
                'first',
                'second'
            ]);
            expect(Object.keys(refs)).toEqual(['second', 'first']);
        });
    });
});
