/**
 * Storage Adapter Interface — KeiAI
 *
 * A virtual file system for binary storage.
 * Web uses OPFS (Origin Private File System), Tauri uses native file system.
 *
 * Path semantics:
 *   - No leading slash required (e.g., "assets/abc123", "cache/temp.bin")
 *   - Nested directories are created automatically
 *   - Use "/" as path separator on all platforms
 */

export interface IStorageAdapter {
	/** Get a renderable URL for the file (Object URL or asset:// protocol) */
	getRenderUrl(path: string): Promise<string | null>;

	/** Revoke a previously created render URL (Web only, no-op on Tauri) */
	revokeRenderUrl(url: string): Promise<void>;

	/** Write binary data to storage. Creates parent directories if needed. */
	write(path: string, data: Uint8Array | Blob): Promise<void>;

	/** Read binary data from storage */
	read(path: string): Promise<Uint8Array | null>;

	/** Delete a file from storage */
	delete(path: string): Promise<void>;

	/** Check if a file exists in storage */
	exists(path: string): Promise<boolean>;
}
