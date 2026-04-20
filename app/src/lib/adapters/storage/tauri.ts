import { exists, mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';
import { appDataDir, join, dirname } from '@tauri-apps/api/path';
import type { IStorageAdapter } from './types';
import { createLogger } from '$lib/adapters/logger';

const logger = createLogger('adapter:storage:tauri');

/**
 * TauriStorageAdapter — Native file system-backed storage for Tauri Desktop/Mobile
 *
 * All files accessed by relative path from app data directory.
 * Path format: "assets/abc123", "cache/temp.bin" (no leading slash)
 * Uses asset:// protocol for zero-copy rendering in the webview.
 */
export class TauriStorageAdapter implements IStorageAdapter {
    private urlCache = new Map<string, string>();
    private baseDir: string | null = null;

    private async getBaseDir(): Promise<string> {
        if (this.baseDir) return this.baseDir;
        this.baseDir = await appDataDir();
        return this.baseDir;
    }

    /**
     * Resolve a relative path to an absolute filesystem path.
     * Creates parent directories if needed (for write operations).
     */
    private async resolvePath(path: string, createDirs = false): Promise<string> {
        const base = await this.getBaseDir();
        const fullPath = await join(base, path);

        if (createDirs) {
            const dir = await dirname(fullPath);
            const dirExists = await exists(dir);
            if (!dirExists) {
                await mkdir(dir, { recursive: true });
            }
        }

        return fullPath;
    }

    async getRenderUrl(path: string): Promise<string | null> {
        const cached = this.urlCache.get(path);
        if (cached) return cached;

        const fullPath = await this.resolvePath(path);
        const fileExists = await exists(fullPath);
        if (!fileExists) return null;

        // convertFileSrc produces asset://localhost/... which the webview renders natively.
        // No memory allocation needed — no revoke required either.
        const url = convertFileSrc(fullPath);
        this.urlCache.set(path, url);
        return url;
    }

    async revokeRenderUrl(url: string): Promise<void> {
        // asset:// URLs have no memory to free, just clean up the cache map
        for (const [path, cached] of this.urlCache) {
            if (cached === url) {
                this.urlCache.delete(path);
                break;
            }
        }
    }

    async write(path: string, data: Uint8Array | Blob): Promise<void> {
        const fullPath = await this.resolvePath(path, true); // createDirs = true
        const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
        await writeFile(fullPath, bytes);
        this.urlCache.delete(path);
    }

    async read(path: string): Promise<Uint8Array | null> {
        const fullPath = await this.resolvePath(path);
        const fileExists = await exists(fullPath);
        if (!fileExists) return null;
        return await readFile(fullPath);
    }

    async delete(path: string): Promise<void> {
        try {
            const fullPath = await this.resolvePath(path);
            await remove(fullPath);
            this.urlCache.delete(path);
        } catch (e) {
            logger.error(`TauriStorageAdapter.delete(${path}) failed:`, e);
        }
    }

    async exists(path: string): Promise<boolean> {
        const fullPath = await this.resolvePath(path);
        return await exists(fullPath);
    }
}
