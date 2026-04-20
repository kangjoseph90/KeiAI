/**
 * Utility Tests
 */

import { describe, it, expect } from 'vitest';
import { generateId } from '$lib/utils/id';

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
});
