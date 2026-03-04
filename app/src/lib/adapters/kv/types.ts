/**
 * Key-Value Storage Adapter Interface
 *
 * Used for storing lightweight string data: user preferences, active session IDs,
 * sync timestamps, etc.
 */
export interface IKeyValueAdapter {
	/** Retrieve a string value. Returns null if not found. */
	get(key: string): Promise<string | null>;

	/** Store a string value. */
	set(key: string, value: string): Promise<void>;

	/** Remove a value by key. */
	remove(key: string): Promise<void>;

	/** Ensure the storage is initialized (especially required for Tauri plugin_store) */
	init(): Promise<void>;
}
