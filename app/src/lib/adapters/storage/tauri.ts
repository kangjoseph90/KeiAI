import { exists, mkdir, readFile, remove, stat, writeFile } from '@tauri-apps/plugin-fs';
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
        const fullPath = await this.resolvePath(path);
        const fileExists = await exists(fullPath);
        if (!fileExists) return null;

        // convertFileSrc produces asset://localhost/... which the webview renders natively.
        // No memory allocation needed — no revoke required either.
        return convertFileSrc(fullPath);
    }

    async revokeRenderUrl(_url: string): Promise<void> {}

    async write(path: string, data: Uint8Array | Blob): Promise<void> {
        const fullPath = await this.resolvePath(path, true); // createDirs = true
        const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
        await writeFile(fullPath, bytes);
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
        } catch (e) {
            logger.error(`TauriStorageAdapter.delete(${path}) failed:`, e);
        }
    }

    async exists(path: string): Promise<boolean> {
        const fullPath = await this.resolvePath(path);
        return await exists(fullPath);
    }

    async getSize(path: string): Promise<number> {
        try {
            const fullPath = await this.resolvePath(path);
            const info = await stat(fullPath);
            return info.size;
        } catch {
            return 0;
        }
    }
}
