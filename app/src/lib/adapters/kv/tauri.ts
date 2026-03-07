import { Store } from '@tauri-apps/plugin-store';
import type { IKeyValueAdapter } from './types';

/**
 * Tauri Key-Value Adapter
 *
 * Uses @tauri-apps/plugin-store to save settings to a physical file
 * in the OS AppData directory (e.g., `<appDataDir>/settings.json`).
 * Resilient against WebView cache clears.
 */
export class TauriKeyValueAdapter implements IKeyValueAdapter {
	private store: Store | null = null;
	private initPromise: Promise<void> | null = null;

	async init(): Promise<void> {
		if (this.initPromise) return this.initPromise;

		this.initPromise = (async () => {
			this.store = await Store.load('settings.json');
		})();

		return this.initPromise;
	}

	private async getStore(): Promise<Store> {
		if (!this.store) {
			await this.init();
		}
		return this.store!;
	}

	async get(key: string): Promise<string | null> {
		const store = await this.getStore();
		const val = await store.get<string>(key);
		return val ?? null;
	}

	async set(key: string, value: string): Promise<void> {
		const store = await this.getStore();
		await store.set(key, value);
		await store.save(); // Persist to disk
	}

	async remove(key: string): Promise<void> {
		const store = await this.getStore();
		await store.delete(key);
		await store.save(); // Persist to disk
	}
}
