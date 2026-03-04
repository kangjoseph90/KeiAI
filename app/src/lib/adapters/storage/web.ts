import type { IStorageAdapter } from './types.js';

/**
 * WebStorageAdapter — OPFS-backed asset file system for Web/PWA
 *
 * All files keyed by UUID (asset ID).
 * Persistent local assets and remote cache blobs live in the same directory.
 * The cache registry (separate DB table) decides what is evictable.
 */
export class WebStorageAdapter implements IStorageAdapter {
	private urlCache = new Map<string, string>();

	private async getFileHandle(id: string, create = false): Promise<FileSystemFileHandle | null> {
		try {
			const root = await navigator.storage.getDirectory();
			const dir = await root.getDirectoryHandle('assets', { create });
			return await dir.getFileHandle(id, { create });
		} catch (e) {
			if (e instanceof Error && e.name === 'NotFoundError') return null;
			throw e;
		}
	}

	async getRenderUrl(id: string): Promise<string | null> {
		const cached = this.urlCache.get(id);
		if (cached) return cached;

		const handle = await this.getFileHandle(id);
		if (!handle) return null;

		const file = await handle.getFile();
		const url = URL.createObjectURL(file);
		this.urlCache.set(id, url);
		return url;
	}

	async revokeRenderUrl(url: string): Promise<void> {
		URL.revokeObjectURL(url);
		for (const [id, cached] of this.urlCache) {
			if (cached === url) {
				this.urlCache.delete(id);
				break;
			}
		}
	}

	async write(id: string, data: Uint8Array | Blob): Promise<void> {
		const handle = await this.getFileHandle(id, true);
		if (!handle) throw new Error(`Failed to create file handle for ${id}`);
		const writable = await handle.createWritable();
		await writable.write(data as FileSystemWriteChunkType);
		await writable.close();
		// Invalidate cached URL if present
		this.urlCache.delete(id);
	}

	async read(id: string): Promise<Uint8Array | null> {
		const handle = await this.getFileHandle(id);
		if (!handle) return null;
		const file = await handle.getFile();
		return new Uint8Array(await file.arrayBuffer());
	}

	async delete(id: string): Promise<void> {
		try {
			const root = await navigator.storage.getDirectory();
			const dir = await root.getDirectoryHandle('assets');
			await dir.removeEntry(id);
			this.urlCache.delete(id);
		} catch (e) {
			if (e instanceof Error && e.name !== 'NotFoundError') throw e;
		}
	}

	async exists(id: string): Promise<boolean> {
		const handle = await this.getFileHandle(id);
		return handle !== null;
	}
}

export const webStorage = new WebStorageAdapter();
