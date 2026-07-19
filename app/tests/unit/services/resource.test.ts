import { describe, expect, it } from 'vitest';
import {
    defaultScriptFields,
    hydrateOwnedItems,
    type Script
} from '$lib/services/content/resource';

describe('hydrateOwnedItems', () => {
    it('fills defaults without mutating stored items', () => {
        const stored = {
            'script-1': {
                id: 'script-1',
                name: 'Stored script',
                sortOrder: 'a0'
            } as Script
        };

        const hydrated = hydrateOwnedItems(stored, defaultScriptFields);

        expect(hydrated['script-1']).toMatchObject({
            ...defaultScriptFields,
            id: 'script-1',
            name: 'Stored script',
            sortOrder: 'a0'
        });
        expect(hydrated['script-1']).not.toBe(stored['script-1']);
    });

    it('uses the record key as canonical identity', () => {
        const hydrated = hydrateOwnedItems(
            {
                'canonical-id': {
                    ...defaultScriptFields,
                    id: 'spoofed-id',
                    sortOrder: 'a0'
                }
            },
            defaultScriptFields
        );

        expect(hydrated['canonical-id'].id).toBe('canonical-id');
    });
});
