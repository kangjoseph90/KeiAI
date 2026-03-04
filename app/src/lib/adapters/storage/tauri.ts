import { exists, mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import type { IStorageAdapter } from './types.js';

/**
 * TauriStorageAdapter — Native file system-backed asset storage for Tauri Desktop/Mobile
 *
 * All files keyed by UUID (asset ID).
 * Stored in <appDataDir>/assets/{uuid}.
 * Uses Tauri's asset:// protocol for zero-copy rendering in the webview.
 */
export class TauriStorageAdapter implements IStorageAdapter {
	private urlCache = new Map<string, string>();
	private assetsDir: string | null = null;

	private async getAssetsDir(): Promise<string> {
		if (this.assetsDir) return this.assetsDir;
		const base = await appDataDir();
		const dir = await join(base, 'assets');
		const dirExists = await exists(dir);
		if (!dirExists) await mkdir(dir, { recursive: true });
		this.assetsDir = dir;
		return dir;
	}

	private async filePath(id: string): Promise<string> {
		const dir = await this.getAssetsDir();
		return await join(dir, id);
	}

	async getRenderUrl(id: string): Promise<string | null> {
		const cached = this.urlCache.get(id);
		if (cached) return cached;

		const path = await this.filePath(id);
		const fileExists = await exists(path);
		if (!fileExists) return null;

		// convertFileSrc produces asset://localhost/... which the webview renders natively.
		// No memory allocation needed — no revoke required either.
		const url = convertFileSrc(path);
		this.urlCache.set(id, url);
		return url;
	}

	async revokeRenderUrl(url: string): Promise<void> {
		// asset:// URLs have no memory to free, just clean up the cache map
		for (const [id, cached] of this.urlCache) {
			if (cached === url) {
				this.urlCache.delete(id);
				break;
			}
		}
	}

	async write(id: string, data: Uint8Array | Blob): Promise<void> {
		const path = await this.filePath(id);
		const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
		await writeFile(path, bytes);
		this.urlCache.delete(id);
	}

	async read(id: string): Promise<Uint8Array | null> {
		const path = await this.filePath(id);
		const fileExists = await exists(path);
		if (!fileExists) return null;
		return await readFile(path);
	}

	async delete(id: string): Promise<void> {
		try {
			const path = await this.filePath(id);
			await remove(path);
			this.urlCache.delete(id);
		} catch (e) {
			console.error(`TauriStorageAdapter.delete(${id}) failed:`, e);
		}
	}

	async exists(id: string): Promise<boolean> {
		const path = await this.filePath(id);
		return await exists(path);
	}
}
