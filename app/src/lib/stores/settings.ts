import { get } from 'svelte/store';
import { SettingsService, type AppSettingsContent, type AppSettings } from '../services/index.js';
import { appSettings } from './state.js';
import type { OrderedRef, FolderDef } from '../shared/types.js';
import { generateSortOrder } from '../shared/ordering.js';
import { AppError } from '../shared/errors.js';
import { generateId } from '../shared/id.js';

/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadSettings(): Promise<void> {
	appSettings.set(await SettingsService.get());
}

export async function updateSettings(changes: Partial<AppSettingsContent>): Promise<void> {
	const updated = await SettingsService.update(changes);
	appSettings.set(updated);
}

// ─── Global Folder & Item Management ──────────────────────

export type GlobalFolderType = 'characters' | 'personas' | 'presets' | 'modules' | 'plugins';

export async function createGlobalFolder(
	folderType: GlobalFolderType,
	name: string,
	parentId?: string
): Promise<FolderDef> {
	const settings = get(appSettings) || await SettingsService.get();

	if (!settings) {
		throw new AppError('NOT_FOUND', 'Settings not found');
	}

	const folders = settings.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const newFolder: FolderDef = {
		id: generateId(),
		name,
		sortOrder: generateSortOrder(typeFolders as OrderedRef[]),
		parentId
	};

	const updatedFolders = { ...folders, [folderType]: [...typeFolders, newFolder] };

	const updated = await SettingsService.update({ folders: updatedFolders });
	appSettings.set(updated);
	return newFolder;
}

export async function updateGlobalFolder(
	folderType: GlobalFolderType,
	folderId: string,
	changes: Partial<{ name: string; color: string; parentId: string; sortOrder: string }>
): Promise<void> {
	const settings = get(appSettings) || await SettingsService.get();

	if (!settings) {
		throw new AppError('NOT_FOUND', 'Settings not found');
	}

	const folders = settings.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const updatedTypeFolders = typeFolders.map((f) => (f.id === folderId ? { ...f, ...changes } : f));

	const updatedFolders = { ...folders, [folderType]: updatedTypeFolders };

	const updated = await SettingsService.update({ folders: updatedFolders });
	appSettings.set(updated);
}

export async function deleteGlobalFolder(folderType: GlobalFolderType, folderId: string): Promise<void> {
	const settings = get(appSettings) || await SettingsService.get();

	if (!settings) {
		throw new AppError('NOT_FOUND', 'Settings not found');
	}

	const folders = settings.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const updatedFolders = { ...folders, [folderType]: typeFolders.filter((f) => f.id !== folderId) };

	const updated = await SettingsService.update({ folders: updatedFolders });
	appSettings.set(updated);
}

export async function moveGlobalItem(
	folderType: GlobalFolderType,
	itemId: string,
	newFolderId?: string,
	newSortOrder?: string
): Promise<void> {
	const settings = get(appSettings) || await SettingsService.get();

	if (!settings) {
		throw new AppError('NOT_FOUND', 'Settings not found');
	}

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
	appSettings.set(updated);
}
