import { vi, describe, it, expect, beforeEach } from 'vitest';
import { UserService } from '$lib/services/user/user';
import { appUser } from '$lib/adapters/user';
import { localDB } from '$lib/adapters/db';
import { appAsset } from '$lib/adapters/asset';
import { appStorage } from '$lib/adapters/storage';
import { appKV } from '$lib/adapters/kv';

vi.mock('$lib/adapters/user', () => ({
	appUser: {
		deleteUser: vi.fn(),
		getAllUsers: vi.fn(),
		saveUser: vi.fn(),
		getUser: vi.fn()
	}
}));

vi.mock('$lib/adapters/db', () => ({
	localDB: {
		deleteByIndex: vi.fn()
	},
	TABLES: ['table1', 'table2', 'table3', 'table4', 'table5', 'table6', 'table7', 'table8', 'table9', 'table10', 'table11', 'table12', 'table13']
}));

vi.mock('$lib/adapters/asset', () => ({
	appAsset: {
		getAllAssets: vi.fn(),
		getAllRegistry: vi.fn(),
		deleteRegistry: vi.fn(),
		putAsset: vi.fn()
	}
}));

vi.mock('$lib/adapters/storage', () => ({
	appStorage: {
		delete: vi.fn()
	}
}));

vi.mock('$lib/adapters/kv', () => ({
	appKV: {
		remove: vi.fn(),
        get: vi.fn(),
        set: vi.fn()
	}
}));

vi.mock('$lib/crypto', () => ({
	generateMasterKey: vi.fn()
}));

vi.mock('$lib/shared/id', () => ({
	generateId: vi.fn(() => 'test-guest-id')
}));

vi.mock('$lib/services/session', () => ({
	setSession: vi.fn()
}));

vi.mock('minidenticons', () => ({
	minidenticon: vi.fn()
}));

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('UserService Delete Performance', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// simulate 10ms delay for each async operation to mimic I/O
		vi.mocked(appUser.deleteUser).mockImplementation(async () => await delay(10));
		vi.mocked(appAsset.deleteRegistry).mockImplementation(async () => await delay(10));
		vi.mocked(appAsset.putAsset).mockImplementation(async () => await delay(10));
		vi.mocked(appStorage.delete).mockImplementation(async () => await delay(10));
		vi.mocked(localDB.deleteByIndex).mockImplementation(async () => await delay(10));
		vi.mocked(appKV.remove).mockImplementation(async () => await delay(10));
	});

	it('should measure deleteUser time', async () => {
		const numAssets = 100; // 100 assets
		const mockAssets = Array.from({ length: numAssets }).map((_, i) => ({ id: `a${i}` })) as any[];
		const mockRegistry = Array.from({ length: numAssets }).map((_, i) => ({ id: `a${i}` })) as any[];

		vi.mocked(appAsset.getAllAssets).mockResolvedValue(mockAssets);
		vi.mocked(appAsset.getAllRegistry).mockResolvedValue(mockRegistry);

		const start = performance.now();
		await UserService.deleteUser('test-user');
		const end = performance.now();

		console.log(`Deletion took ${end - start} ms`);
	}, 10000);
});
