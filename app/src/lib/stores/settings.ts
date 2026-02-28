import { get } from 'svelte/store';
import { SettingsService, type AppSettings } from '../services';
import { appSettings } from './state.js';

export async function loadSettings() {
	appSettings.set(await SettingsService.get());
}

export async function updateSettings(changes: Partial<AppSettings>) {
	const current = get(appSettings) || ({} as AppSettings);
	const updated = { ...current, ...changes } as AppSettings;
	await SettingsService.update(updated);
	appSettings.set(updated);
}