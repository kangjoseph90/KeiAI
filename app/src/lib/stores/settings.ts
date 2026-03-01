import { get } from 'svelte/store';
import { SettingsService, type AppSettingsContent, type AppSettings } from '../services';
import { appSettings } from './state.js';
import type { OrderedRef } from '../db/index.js';
import { generateSortOrder } from '../utils/ordering.js';

export async function loadSettings() {
	appSettings.set(await SettingsService.get());
}

export async function updateSettings(changes: Partial<AppSettingsContent>) {
	const updated = await SettingsService.update(changes);
	if (updated) appSettings.set(updated);
}

// ─── Global Folder & Item Management ──────────────────────

export type GlobalFolderType = 'characters' | 'personas' | 'presets' | 'modules' | 'plugins';

export async function createGlobalFolder(
	folderType: GlobalFolderType,
	name: string,
	parentId?: string
) {
	const settings = get(appSettings);
	if (!settings) return;

	const folders = settings.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const newFolder = {
		id: crypto.randomUUID(),
		name,
		sortOrder: generateSortOrder(typeFolders as OrderedRef[]),
		parentId
	};

	const updatedFolders = {
		...folders,
		[folderType]: [...typeFolders, newFolder]
	};

	const updated = await SettingsService.update({ folders: updatedFolders });
	if (updated) appSettings.set(updated);
	return newFolder;
}

export async function updateGlobalFolder(
	folderType: GlobalFolderType,
	folderId: string,
	changes: Partial<{ name: string; color: string; parentId: string; sortOrder: string }>
) {
	const settings = get(appSettings);
	if (!settings) return;

	const folders = settings.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const updatedTypeFolders = typeFolders.map((f) => (f.id === folderId ? { ...f, ...changes } : f));

	const updatedFolders = {
		...folders,
		[folderType]: updatedTypeFolders
	};

	const updated = await SettingsService.update({ folders: updatedFolders });
	if (updated) appSettings.set(updated);
}

export async function deleteGlobalFolder(folderType: GlobalFolderType, folderId: string) {
	const settings = get(appSettings);
	if (!settings) return;

	const folders = settings.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const updatedTypeFolders = typeFolders.filter((f) => f.id !== folderId);

	const updatedFolders = {
		...folders,
		[folderType]: updatedTypeFolders
	};

	const updated = await SettingsService.update({ folders: updatedFolders });
	if (updated) appSettings.set(updated);
}

export async function moveGlobalItem(
	folderType: GlobalFolderType,
	itemId: string,
	newFolderId?: string,
	newSortOrder?: string
) {
	const settings = get(appSettings);
	if (!settings) return;

	let refKey: keyof AppSettings;
	switch (folderType) {
		case 'characters':
			refKey = 'characterRefs';
			break;
		case 'personas':
			refKey = 'personaRefs';
			break;
		case 'presets':
			refKey = 'presetRefs';
			break;
		case 'modules':
			refKey = 'moduleRefs';
			break;
		case 'plugins':
			refKey = 'pluginRefs';
			break;
		default:
			return;
	}

	const refs = (settings[refKey] as OrderedRef[]) ?? [];
	const updatedRefs = refs.map((ref) => {
		if (ref.id !== itemId) return ref;
		return {
			...ref,
			folderId: newFolderId,
			sortOrder: newSortOrder ?? ref.sortOrder
		};
	});

	const updated = await SettingsService.update({ [refKey]: updatedRefs } as Partial<AppSettings>);
	if (updated) appSettings.set(updated);
}
