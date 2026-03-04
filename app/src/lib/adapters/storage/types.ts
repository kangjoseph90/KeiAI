/**
 * Storage Adapter Interface — KeiAI
 *
 * A virtual file system for asset binary storage.
 * Web uses OPFS (Origin Private File System), Tauri uses native file system.
 * Stores both persistent local assets and remote asset caches in the same location.
 * Files are keyed by UUID (asset ID).
 */

export interface IStorageAdapter {
	/** Get a renderable URL for the file (Object URL or asset:// protocol) */
	getRenderUrl(id: string): Promise<string | null>;

	/** Revoke a previously created render URL (Web only, no-op on Tauri) */
	revokeRenderUrl(url: string): Promise<void>;

	/** Write binary data to storage */
	write(id: string, data: Uint8Array | Blob): Promise<void>;

	/** Read binary data from storage */
	read(id: string): Promise<Uint8Array | null>;

	/** Delete a file from storage */
	delete(id: string): Promise<void>;

	/** Check if a file exists in storage */
	exists(id: string): Promise<boolean>;
}