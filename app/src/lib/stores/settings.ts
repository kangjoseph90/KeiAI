import { get } from 'svelte/store';
import { SettingsService, type AppSettings } from '../services';
import { appSettings } from './state.js';
import type { OrderedRef } from '../db/index.js';
import { generateSortOrder } from './ordering.js';

export async function loadSettings() {
	appSettings.set(await SettingsService.get());
}

export async function updateSettings(changes: Partial<AppSettings>) {
	const current = get(appSettings) || ({} as AppSettings);
	const updated = { ...current, ...changes } as AppSettings;
	await SettingsService.update(updated);
	appSettings.set(updated);
}

// ─── Global Folder & Item Management ──────────────────────

export type GlobalFolderType = 'characters' | 'personas' | 'presets' | 'modules' | 'plugins';

export async function createGlobalFolder(folderType: GlobalFolderType, name: string, parentId?: string) {
	const settings = get(appSettings);
	if (!settings) return;

	const folders = settings.folders ?? {};
	const typeFolders = folders[folderType] ?? [];
	
	const newFolder = {
		id: crypto.randomUUID(),
		name,
		sortOrder: generateSortOrder(typeFolders as any),
		parentId
	};

	const updatedFolders = {
		...folders,
		[folderType]: [...typeFolders, newFolder]
	};

	await updateSettings({ folders: updatedFolders });
	return newFolder;
}

export async function updateGlobalFolder(folderType: GlobalFolderType, folderId: string, changes: Partial<{name: string, color: string, parentId: string, sortOrder: string}>) {
	const settings = get(appSettings);
	if (!settings) return;

	const folders = settings.folders ?? {};
	const typeFolders = folders[folderType] ?? [];
	
	const updatedTypeFolders = typeFolders.map(f => f.id === folderId ? { ...f, ...changes } : f);
	
	const updatedFolders = {
		...folders,
		[folderType]: updatedTypeFolders
	};

	await updateSettings({ folders: updatedFolders });
}

export async function deleteGlobalFolder(folderType: GlobalFolderType, folderId: string) {
	const settings = get(appSettings);
	if (!settings) return;

	const folders = settings.folders ?? {};
	const typeFolders = folders[folderType] ?? [];
	
	const updatedTypeFolders = typeFolders.filter(f => f.id !== folderId);
	
	const updatedFolders = {
		...folders,
		[folderType]: updatedTypeFolders
	};

	await updateSettings({ folders: updatedFolders });
}

export async function moveGlobalItem(folderType: GlobalFolderType, itemId: string, newFolderId?: string, newSortOrder?: string) {
	const settings = get(appSettings);
	if (!settings) return;

	let refKey: keyof typeof settings;
	switch (folderType) {
		case 'characters': refKey = 'characterRefs'; break;
		case 'personas': refKey = 'personaRefs'; break;
		case 'presets': refKey = 'presetRefs'; break;
		case 'modules': refKey = 'moduleRefs'; break;
		case 'plugins': refKey = 'pluginRefs'; break;
		default: return;
	}

	const refs = (settings[refKey] as OrderedRef[]) ?? [];
	const updatedRefs = refs.map(ref => {
		if (ref.id !== itemId) return ref;
		return {
			...ref,
			folderId: newFolderId,
			sortOrder: newSortOrder ?? ref.sortOrder
		};
	});

	await updateSettings({ [refKey]: updatedRefs } as any);
}