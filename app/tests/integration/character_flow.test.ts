/**
 * Character Flow Integration Tests
 *
 * Tests the interaction between CharacterService and LorebookService
 * using a real Dexie database (fake-indexeddb).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CharacterService } from '$lib/services/content/character';
import { LorebookService } from '$lib/services/content/lorebook';
import { setUserSession, clearSession } from '$lib/services';
import { encrypt, decrypt } from '$lib/crypto';
import { localDB, type TableName } from '$lib/adapters/db';
import { buffer } from '$lib/services/content/record_buffer';

// Mock high-level dependencies
vi.mock('$lib/crypto', () => ({
    encrypt: vi.fn(),
    decrypt: vi.fn()
}));

// Session will be managed via setUserSession/clearSession in beforeEach/afterEach

vi.mock('$lib/services/content/record_buffer', () => ({
    buffer: {
        get: vi.fn(),
        update: vi.fn(),
        drop: vi.fn(),
        flushTable: vi.fn()
    }
}));

describe('Character Flow Integration', () => {
    const mockMasterKey = {} as CryptoKey;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Use a unique userId per test for isolation
        const uniqueUserId = `user-${Math.random()}`;

        // Set session
        setUserSession({
            userId: uniqueUserId,
            masterKey: mockMasterKey,
            identityKeyPair: {} as CryptoKeyPair
        });

        // Mock crypto to just return the data as-is (simulated encryption)
        vi.mocked(encrypt).mockImplementation(async (_key, data) => ({
            ciphertext: new TextEncoder().encode(data),
            iv: new Uint8Array([1, 2, 3])
        }));

        vi.mocked(decrypt).mockImplementation(async (_key, enc) => {
            return new TextDecoder().decode(enc.ciphertext);
        });

        // Mock buffer.get to fetch from localDB for integration realism
        vi.mocked(buffer.get).mockImplementation(async (table, id) => {
            const record = await localDB.getRecord(table as TableName, id);
            return (record ?? null) as unknown as never;
        });
    });

    it('should create a character and associate it with a lorebook', async () => {
        // 1. Create a character
        const character = await CharacterService.create({
            name: 'Integration Hero',
            characterNote: 'You are a hero.'
        });

        expect(character.id).toBeDefined();
        expect(character.name).toBe('Integration Hero');

        // 2. Create a lorebook owned by this character
        const lorebook = await LorebookService.create(character.id, {
            name: 'The Hero Sword',
            content: 'A powerful blade.'
        });

        expect(lorebook.ownerId).toBe(character.id);
        expect(lorebook.name).toBe('The Hero Sword');

        // 3. Verify character can list its lorebooks
        const lorebooks = await LorebookService.listByOwner(character.id);
        expect(lorebooks).toHaveLength(1);
        expect(lorebooks[0].id).toBe(lorebook.id);
        expect(lorebooks[0].name).toBe('The Hero Sword');

        // 4. Delete the character
        await CharacterService.delete(character.id);

        // 5. Verify character is gone
        const deletedChar = await CharacterService.get(character.id);
        expect(deletedChar).toBeNull();

        // 6. Verify lorebook is also soft-deleted (listByOwner should be empty)
        const remainingLorebooks = await LorebookService.listByOwner(character.id);
        expect(remainingLorebooks).toHaveLength(0);
    });
});
