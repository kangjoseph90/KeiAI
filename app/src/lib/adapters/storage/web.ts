import type { IStorageAdapter } from './types';
import { AppError } from '$lib/types/errors';

/**
 * WebStorageAdapter — OPFS-backed virtual file system for Web/PWA
 *
 * All files accessed by relative path (e.g., "assets/abc123", "cache/temp.bin").
 * Nested directories are created automatically.
 * Uses Object URLs for rendering which must be revoked when no longer needed.
 */
export class WebStorageAdapter implements IStorageAdapter {
    /**
     * Resolve a path to a file handle, creating parent directories as needed.
     * Path format: "dir/subdir/filename" (no leading slash)
     */
    private async getFileHandle(
        path: string,
        create = false
    ): Promise<FileSystemFileHandle | null> {
        try {
            const root = await navigator.storage.getDirectory();
            const parts = path.split('/');

            // Navigate/create all directories except the last part (filename)
            let current = root;
            for (let i = 0; i < parts.length - 1; i++) {
                current = await current.getDirectoryHandle(parts[i], { create });
            }

            // Last part is the filename
            const filename = parts[parts.length - 1];
            return await current.getFileHandle(filename, { create });
        } catch (e) {
            if (e instanceof Error && e.name === 'NotFoundError') return null;
            throw e;
        }
    }

    async getRenderUrl(path: string): Promise<string | null> {
        const handle = await this.getFileHandle(path);
        if (!handle) return null;

        const file = await handle.getFile();
        return URL.createObjectURL(file);
    }

    async revokeRenderUrl(url: string): Promise<void> {
        URL.revokeObjectURL(url);
    }

    async write(path: string, data: Uint8Array | Blob): Promise<void> {
        const handle = await this.getFileHandle(path, true);
        if (!handle)
            throw new AppError('STORAGE_ERROR', `Failed to create file handle for ${path}`);
        const writable = await handle.createWritable();
        await writable.write(data as FileSystemWriteChunkType);
        await writable.close();
    }

    async read(path: string): Promise<Uint8Array | null> {
        const handle = await this.getFileHandle(path);
        if (!handle) return null;
        const file = await handle.getFile();
        return new Uint8Array(await file.arrayBuffer());
    }

    async delete(path: string): Promise<void> {
        try {
            const root = await navigator.storage.getDirectory();
            const parts = path.split('/');

            // Navigate to parent directory
            let current = root;
            for (let i = 0; i < parts.length - 1; i++) {
                current = await current.getDirectoryHandle(parts[i]);
            }

            // Remove the file
            const filename = parts[parts.length - 1];
            await current.removeEntry(filename);
        } catch (e) {
            if (e instanceof Error && e.name !== 'NotFoundError') throw e;
        }
    }

    async exists(path: string): Promise<boolean> {
        const handle = await this.getFileHandle(path);
        return handle !== null;
    }

    async getSize(path: string): Promise<number> {
        const handle = await this.getFileHandle(path);
        if (!handle) return 0;
        const file = await handle.getFile();
        return file.size;
    }
}

export const webStorage = new WebStorageAdapter();
