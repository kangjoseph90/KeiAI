import type { IStorageAdapter } from './types';
import { createRenderBlob } from './render';
import { AppError } from '$lib/types/errors';
import { createLogger } from '$lib/adapters/logger';
import Dexie, { type Table } from 'dexie';

const logger = createLogger('adapter:storage:web');
const FALLBACK_DB_NAME = 'KeiStorage';

interface StoredFileRecord {
    path: string;
    bytes: ArrayBuffer;
}

class StorageFallbackDexie extends Dexie {
    files!: Table<StoredFileRecord, string>;

    constructor(name: string) {
        super(name);
        this.version(1).stores({ files: 'path' });
    }
}

class IndexedDbStorageFallback {
    private readonly db: StorageFallbackDexie;

    constructor(databaseName: string) {
        this.db = new StorageFallbackDexie(databaseName);
    }

    async write(path: string, data: Uint8Array | Blob): Promise<void> {
        const bytes = data instanceof Blob ? await data.arrayBuffer() : copyBuffer(data);
        await this.db.files.put({ path, bytes });
    }

    async read(path: string): Promise<Uint8Array | null> {
        const record = await this.db.files.get(path);
        return record ? new Uint8Array(record.bytes.slice(0)) : null;
    }

    async delete(path: string): Promise<void> {
        await this.db.files.delete(path);
    }

    async exists(path: string): Promise<boolean> {
        return (await this.db.files.get(path)) !== undefined;
    }

    async getSize(path: string): Promise<number> {
        const record = await this.db.files.get(path);
        return record?.bytes.byteLength ?? 0;
    }
}

function copyBuffer(data: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy.buffer;
}

/**
 * WebStorageAdapter — OPFS-backed virtual file system for Web/PWA
 *
 * All files accessed by relative path (e.g., "assets/abc123", "cache/temp.bin").
 * Nested directories are created automatically.
 * Uses Object URLs for rendering which must be revoked when no longer needed.
 */
export class WebStorageAdapter implements IStorageAdapter {
    private readonly fallback: IndexedDbStorageFallback;
    private opfsRootPromise: Promise<FileSystemDirectoryHandle | null> | null = null;

    constructor(fallbackDatabaseName = FALLBACK_DB_NAME) {
        this.fallback = new IndexedDbStorageFallback(fallbackDatabaseName);
    }

    private getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
        if (this.opfsRootPromise) return this.opfsRootPromise;

        const storage = globalThis.navigator?.storage;
        if (!storage || typeof storage.getDirectory !== 'function') {
            this.opfsRootPromise = Promise.resolve(null);
            return this.opfsRootPromise;
        }

        this.opfsRootPromise = storage.getDirectory().catch((error: unknown) => {
            logger.warn('OPFS unavailable; using IndexedDB storage fallback', error);
            return null;
        });
        return this.opfsRootPromise;
    }

    /**
     * Resolve a path to a file handle, creating parent directories as needed.
     * Path format: "dir/subdir/filename" (no leading slash)
     */
    private async getOpfsFileHandle(
        root: FileSystemDirectoryHandle,
        path: string,
        create = false
    ): Promise<FileSystemFileHandle | null> {
        try {
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

    async getRenderUrl(
        path: string,
        mimeType = 'application/octet-stream'
    ): Promise<string | null> {
        const root = await this.getOpfsRoot();
        if (root) {
            const handle = await this.getOpfsFileHandle(root, path);
            if (handle) {
                const file = await handle.getFile();
                return URL.createObjectURL(await createRenderBlob(file, mimeType));
            }
        }

        const bytes = await this.fallback.read(path);
        return bytes ? URL.createObjectURL(await createRenderBlob(bytes, mimeType)) : null;
    }

    async revokeRenderUrl(url: string): Promise<void> {
        URL.revokeObjectURL(url);
    }

    async write(path: string, data: Uint8Array | Blob): Promise<void> {
        const root = await this.getOpfsRoot();
        if (root) {
            const handle = await this.getOpfsFileHandle(root, path, true);
            if (!handle) {
                throw new AppError('STORAGE_ERROR', `Failed to create file handle for ${path}`);
            }
            const writable = await handle.createWritable();
            await writable.write(data as FileSystemWriteChunkType);
            await writable.close();
            await this.fallback.delete(path);
            return;
        }

        await this.fallback.write(path, data);
    }

    async read(path: string): Promise<Uint8Array | null> {
        const root = await this.getOpfsRoot();
        if (root) {
            const handle = await this.getOpfsFileHandle(root, path);
            if (handle) return new Uint8Array(await (await handle.getFile()).arrayBuffer());
        }
        return this.fallback.read(path);
    }

    async delete(path: string): Promise<void> {
        const root = await this.getOpfsRoot();
        try {
            if (!root) return;
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
        } finally {
            await this.fallback.delete(path);
        }
    }

    async exists(path: string): Promise<boolean> {
        const root = await this.getOpfsRoot();
        if (root && (await this.getOpfsFileHandle(root, path))) return true;
        return this.fallback.exists(path);
    }

    async getSize(path: string): Promise<number> {
        const root = await this.getOpfsRoot();
        if (root) {
            const handle = await this.getOpfsFileHandle(root, path);
            if (handle) return (await handle.getFile()).size;
        }
        return this.fallback.getSize(path);
    }
}
