import { expect, test, vi } from 'vitest';
import { CharacterService } from '../../../src/lib/services/content/character';
import { localDB } from '../../../src/lib/adapters/db';
import { getActiveSession } from '../../../src/lib/services/session';

// Setup mocks
vi.mock('../../../src/lib/adapters/db', () => {
	return {
		localDB: {
			getByIndex: vi.fn(),
			transaction: vi.fn(),
			softDeleteByIndex: vi.fn(),
			softDeleteRecord: vi.fn()
		}
	};
});

vi.mock('../../../src/lib/services/session', () => {
	return {
		getActiveSession: vi.fn(() => ({ masterKey: {} as CryptoKey, userId: 'user-1' }))
	};
});

test('CharacterService.delete performance benchmark', async () => {
	// Generate 1000 chats
	const mockChats = Array.from({ length: 1000 }, (_, i) => ({ id: `chat-${i}` }));

	// Setup mock implementation
	vi.mocked(localDB.getByIndex).mockResolvedValue(mockChats as unknown as never[]);

	vi.mocked(localDB.transaction).mockImplementation(async (tables, mode, callback) => {
		return callback();
	});

	// Simulate 1ms latency for softDeleteByIndex
	vi.mocked(localDB.softDeleteByIndex).mockImplementation(async () => {
		await new Promise((resolve) => setTimeout(resolve, 1));
	});
	vi.mocked(localDB.softDeleteRecord).mockImplementation(async () => {
		await new Promise((resolve) => setTimeout(resolve, 1));
	});

	const start = performance.now();
	await CharacterService.delete('char-1');
	const end = performance.now();

	console.log(`Deletion took ${end - start} ms`);
});
