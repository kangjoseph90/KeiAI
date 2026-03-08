/**
 * Storage Adapter Tests
 *
 * Tests WebStorageAdapter (OPFS wrapper).
 * Uses mocks for the Origin Private File System APIs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebStorageAdapter } from '$lib/adapters/storage/web';
import type { IStorageAdapter } from '$lib/adapters/storage/types';

// Mock OPFS (Origin Private File System) APIs
class MockFileSystemFileHandle {
	constructor(
		private data: Uint8Array | null = null,
		private fileName: string = ''
	) {}

	async getFile(): Promise<File> {
		if (!this.data) {
			throw new Error('NotFoundError');
		}
		return new File([this.data as unknown as BlobPart], this.fileName, {
			type: 'application/octet-stream'
		});
	}

	async createWritable(): Promise<MockFileSystemWritableFileStream> {
		return new MockFileSystemWritableFileStream(this);
	}

	setData(data: Uint8Array) {
		this.data = data;
	}

	getData(): Uint8Array | null {
		return this.data;
	}
}

class MockFileSystemWritableFileStream {
	private chunks: Uint8Array[] = [];

	constructor(private handle: MockFileSystemFileHandle) {}

	async write(data: Uint8Array | Blob | string): Promise<void> {
		if (typeof data === 'string') {
			this.chunks.push(new TextEncoder().encode(data));
		} else if (data instanceof Blob) {
			const buffer = await data.arrayBuffer();
			this.chunks.push(new Uint8Array(buffer));
		} else {
			this.chunks.push(data);
		}
	}

	async close(): Promise<void> {
		const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
		const combined = new Uint8Array(totalLength);
		let offset = 0;
		for (const chunk of this.chunks) {
			combined.set(chunk, offset);
			offset += chunk.length;
		}
		this.handle.setData(combined);
		this.chunks = [];
	}
}

class MockFileSystemDirectoryHandle {
	private files = new Map<string, MockFileSystemFileHandle>();
	private directories = new Map<string, MockFileSystemDirectoryHandle>();
	private name: string;

	constructor(name: string) {
		this.name = name;
	}

	async getDirectoryHandle(name: string, options?: { create?: boolean }) {
		let dir = this.directories.get(name);
		if (!dir) {
			if (options?.create) {
				dir = new MockFileSystemDirectoryHandle(name);
				this.directories.set(name, dir);
			} else {
				const error = new Error('Directory not found') as Error & { name?: string };
				error.name = 'NotFoundError';
				throw error;
			}
		}
		return dir;
	}

	async getFileHandle(name: string, options?: { create?: boolean }) {
		let file = this.files.get(name);
		if (!file) {
			if (options?.create) {
				file = new MockFileSystemFileHandle(null, name);
				this.files.set(name, file);
			} else {
				const error = new Error('File not found') as Error & { name?: string };
				error.name = 'NotFoundError';
				throw error;
			}
		}
		return file;
	}

	async removeEntry(name: string) {
		const exists = this.files.has(name);
		this.files.delete(name);
		if (!exists) {
			const error = new Error('Entry not found') as Error & { name?: string };
			error.name = 'NotFoundError';
			throw error;
		}
	}

	getFile(name: string): MockFileSystemFileHandle | undefined {
		return this.files.get(name);
	}

	getDirectory(name: string): MockFileSystemDirectoryHandle | undefined {
		return this.directories.get(name);
	}

	clearAll() {
		this.files.clear();
		this.directories.clear();
	}
}

// Mock navigator.storage
const mockRootDir = new MockFileSystemDirectoryHandle('root');
const mockGetDirectory = vi.fn().mockResolvedValue(mockRootDir);

vi.stubGlobal('navigator', {
	storage: {
		getDirectory: mockGetDirectory
	}
});

describe('WebStorageAdapter (OPFS)', () => {
	let adapter: IStorageAdapter;
	let assetsDir: MockFileSystemDirectoryHandle;

	beforeEach(async () => {
		// Get or create the assets directory mock
		const existing = mockRootDir.getDirectory('assets');
		if (existing) {
			assetsDir = existing;
		} else {
			assetsDir = await mockRootDir.getDirectoryHandle('assets', { create: true });
		}

		adapter = new WebStorageAdapter();
	});

	afterEach(() => {
		// Clear all mock directories
		mockRootDir.clearAll();
		vi.clearAllMocks();
	});

	describe('write and read', () => {
		it('should write and read binary data', async () => {
			const data = new Uint8Array([1, 2, 3, 4, 5]);
			const id = 'test-file-1';

			await adapter.write(id, data);
			const result = await adapter.read(id);

			expect(result).not.toBeNull();
			expect(Array.from(result!)).toEqual([1, 2, 3, 4, 5]);
		});

		it('should write and read blob data', async () => {
			const data = new Blob(['Hello, World!']);
			const id = 'test-file-2';

			await adapter.write(id, data);
			const result = await adapter.read(id);

			expect(result).not.toBeNull();
			expect(new TextDecoder().decode(result!)).toBe('Hello, World!');
		});

		it('should overwrite existing files', async () => {
			const id = 'test-file-3';
			const firstData = new Uint8Array([1, 2, 3]);
			const secondData = new Uint8Array([4, 5, 6]);

			await adapter.write(id, firstData);
			await adapter.write(id, secondData);

			const result = await adapter.read(id);
			expect(Array.from(result!)).toEqual([4, 5, 6]);
		});

		it('should return null for non-existent files', async () => {
			const result = await adapter.read('non-existent-file');
			expect(result).toBeNull();
		});

		it('should handle empty data', async () => {
			const data = new Uint8Array([]);
			const id = 'empty-file';

			await adapter.write(id, data);
			const result = await adapter.read(id);

			expect(result).not.toBeNull();
			expect(result!.length).toBe(0);
		});

		it('should handle large files', async () => {
			const largeData = new Uint8Array(1024 * 1024); // 1MB
			for (let i = 0; i < largeData.length; i++) {
				largeData[i] = i % 256;
			}
			const id = 'large-file';

			await adapter.write(id, largeData);
			const result = await adapter.read(id);

			expect(result).not.toBeNull();
			expect(result!.length).toBe(1024 * 1024);
			expect(result![0]).toBe(0);
			expect(result![1023]).toBe(255);
		});
	});

	describe('exists', () => {
		it('should return true for existing files', async () => {
			const data = new Uint8Array([1, 2, 3]);
			const id = 'exists-test-1';

			await adapter.write(id, data);
			const exists = await adapter.exists(id);

			expect(exists).toBe(true);
		});

		it('should return false for non-existent files', async () => {
			const exists = await adapter.exists('non-existent-file');
			expect(exists).toBe(false);
		});
	});

	describe('delete', () => {
		it('should delete existing files', async () => {
			const data = new Uint8Array([1, 2, 3]);
			const id = 'delete-test-1';

			await adapter.write(id, data);
			expect(await adapter.exists(id)).toBe(true);

			await adapter.delete(id);
			expect(await adapter.exists(id)).toBe(false);
		});

		it('should not throw when deleting non-existent files', async () => {
			await expect(adapter.delete('non-existent-file')).resolves.not.toThrow();
		});

		it('should allow reusing IDs after deletion', async () => {
			const id = 'reuse-test';
			const firstData = new Uint8Array([1, 2, 3]);
			const secondData = new Uint8Array([4, 5, 6]);

			await adapter.write(id, firstData);
			await adapter.delete(id);
			await adapter.write(id, secondData);

			const result = await adapter.read(id);
			expect(Array.from(result!)).toEqual([4, 5, 6]);
		});
	});

	describe('getRenderUrl and revokeRenderUrl', () => {
		it('should create object URL for existing files', async () => {
			const data = new Uint8Array([1, 2, 3]);
			const id = 'url-test-1';

			await adapter.write(id, data);
			const url = await adapter.getRenderUrl(id);

			expect(url).not.toBeNull();
			expect(url).toMatch(/^blob:/);
		});

		it('should return null for non-existent files', async () => {
			const url = await adapter.getRenderUrl('non-existent-file');
			expect(url).toBeNull();
		});

		it('should cache URLs for subsequent calls', async () => {
			const data = new Uint8Array([1, 2, 3]);
			const id = 'cache-test-1';

			await adapter.write(id, data);
			const url1 = await adapter.getRenderUrl(id);
			const url2 = await adapter.getRenderUrl(id);

			expect(url1).toBe(url2);
		});

		it('should invalidate cache on file update', async () => {
			const id = 'invalidate-test';
			const firstData = new Uint8Array([1, 2, 3]);
			const secondData = new Uint8Array([4, 5, 6]);

			await adapter.write(id, firstData);
			const url1 = await adapter.getRenderUrl(id);

			await adapter.write(id, secondData);
			const url2 = await adapter.getRenderUrl(id);

			// URLs should be different after update (cache invalidated)
			expect(url1).not.toBe(url2);
		});

		it('should revoke cached URLs', async () => {
			const data = new Uint8Array([1, 2, 3]);
			const id = 'revoke-test';

			await adapter.write(id, data);
			const url = await adapter.getRenderUrl(id);

			// Revoke should not throw
			await expect(adapter.revokeRenderUrl(url!)).resolves.not.toThrow();
		});

		it('should remove revoked URL from cache', async () => {
			const data = new Uint8Array([1, 2, 3]);
			const id = 'revoke-cache-test';

			await adapter.write(id, data);
			const url1 = await adapter.getRenderUrl(id);
			await adapter.revokeRenderUrl(url1!);

			// After revoking, getRenderUrl should create a new URL
			const url2 = await adapter.getRenderUrl(id);
			expect(url1).not.toBe(url2);
		});

		it('should clear cache on file deletion', async () => {
			const id = 'delete-cache-test';
			const data = new Uint8Array([1, 2, 3]);

			await adapter.write(id, data);
			const url1 = await adapter.getRenderUrl(id);

			await adapter.delete(id);
			await adapter.write(id, data);

			// After deletion, cache should be cleared
			const url2 = await adapter.getRenderUrl(id);
			expect(url1).not.toBe(url2);
		});
	});

	describe('integration scenarios', () => {
		it('should handle asset lifecycle: write, read, render, delete', async () => {
			const imageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG header
			const assetId = 'asset-123';

			// Store asset
			await adapter.write(assetId, imageData);

			// Verify storage
			expect(await adapter.exists(assetId)).toBe(true);
			const readData = await adapter.read(assetId);
			expect(Array.from(readData!)).toEqual([0xff, 0xd8, 0xff, 0xe0]);

			// Get render URL
			const url = await adapter.getRenderUrl(assetId);
			expect(url).toMatch(/^blob:/);

			// Cleanup
			await adapter.revokeRenderUrl(url!);
			await adapter.delete(assetId);
			expect(await adapter.exists(assetId)).toBe(false);
		});

		it('should handle multiple files independently', async () => {
			const files = [
				{ id: 'file-1', data: new Uint8Array([1, 1, 1]) },
				{ id: 'file-2', data: new Uint8Array([2, 2, 2]) },
				{ id: 'file-3', data: new Uint8Array([3, 3, 3]) }
			];

			// Write all files
			for (const file of files) {
				await adapter.write(file.id, file.data);
			}

			// Verify all exist
			for (const file of files) {
				expect(await adapter.exists(file.id)).toBe(true);
			}

			// Delete middle file
			await adapter.delete('file-2');

			// Verify others still exist
			expect(await adapter.exists('file-1')).toBe(true);
			expect(await adapter.exists('file-2')).toBe(false);
			expect(await adapter.exists('file-3')).toBe(true);

			// Verify data integrity
			const data1 = await adapter.read('file-1');
			const data3 = await adapter.read('file-3');
			expect(Array.from(data1!)).toEqual([1, 1, 1]);
			expect(Array.from(data3!)).toEqual([3, 3, 3]);
		});
	});
});

describe('IStorageAdapter interface contract', () => {
	it('should have all required methods', () => {
		const adapter = new WebStorageAdapter();

		expect(typeof adapter.getRenderUrl).toBe('function');
		expect(typeof adapter.revokeRenderUrl).toBe('function');
		expect(typeof adapter.write).toBe('function');
		expect(typeof adapter.read).toBe('function');
		expect(typeof adapter.delete).toBe('function');
		expect(typeof adapter.exists).toBe('function');
	});

	it('should have async methods that return promises', async () => {
		const adapter = new WebStorageAdapter();

		const promises = [
			adapter.getRenderUrl('id'),
			adapter.revokeRenderUrl('url'),
			adapter.write('id', new Uint8Array([])),
			adapter.read('id'),
			adapter.delete('id'),
			adapter.exists('id')
		];

		for (const promise of promises) {
			expect(promise).toBeInstanceOf(Promise);
		}

		// Clean up
		await Promise.allSettled(promises);
		await adapter.delete('id');
	});
});
