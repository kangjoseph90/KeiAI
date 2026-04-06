import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	loadModules,
	createModule,
	updateModule,
	deleteModule,
	createModuleLorebook,
	deleteModuleLorebook,
	createModuleScript,
	deleteModuleScript,
	createModuleFolder,
	updateModuleFolder,
	deleteModuleFolder,
	moveModuleItem
} from '$lib/stores/content/module';
import { modules, appSettings, moduleResources } from '$lib/stores/state';
import { ModuleService, LorebookService, ScriptService, SettingsService } from '$lib/services';
import { AppError } from '$lib/types/errors';
import type { Module, ModuleContent, Lorebook, Script, AppSettings } from '$lib/services';
import type { FolderDef } from '$lib/types/refs';

// Mock Services
vi.mock('$lib/services', () => ({
	ModuleService: {
		list: vi.fn(),
		get: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		updateContent: vi.fn(),
		delete: vi.fn()
	},
	LorebookService: {
		listByOwner: vi.fn(),
		create: vi.fn(),
		delete: vi.fn()
	},
	ScriptService: {
		listByOwner: vi.fn(),
		create: vi.fn(),
		delete: vi.fn()
	},
	SettingsService: {
		get: vi.fn(),
		update: vi.fn()
	}
}));

// Mock Shared
vi.mock('$lib/utils/id', () => ({
	generateId: vi.fn(() => 'new-id')
}));

vi.mock('$lib/utils/ordering', () => ({
	generateSortOrder: vi.fn(() => 'sort-order'),
	sortByRefs: vi.fn((list) => list)
}));

describe('Module Store', () => {
	const mockModule: Module = {
		id: 'mod-1',
		name: 'Test Module',
		description: 'Description',
		lorebookRefs: [],
		scriptRefs: []
	};

	beforeEach(() => {
		vi.clearAllMocks();
		modules.set([]);
		appSettings.set({ theme: 'dark', providers: {}, moduleRefs: [] } as AppSettings);
		moduleResources.set(new Map());
	});

	describe('loadModules', () => {
		it('should load modules and their resources', async () => {
			vi.mocked(ModuleService.list).mockResolvedValue([mockModule]);
			vi.mocked(LorebookService.listByOwner).mockResolvedValue([]);
			vi.mocked(ScriptService.listByOwner).mockResolvedValue([]);

			await loadModules();

			expect(get(modules)).toEqual([mockModule]);
			expect(get(moduleResources).has('mod-1')).toBe(true);
			expect(ModuleService.list).toHaveBeenCalled();
		});
	});

	describe('createModule', () => {
		it('should create module and update settings', async () => {
			vi.mocked(ModuleService.create).mockResolvedValue(mockModule);
			vi.mocked(SettingsService.update).mockResolvedValue({} as AppSettings);

			const result = await createModule({ name: 'New', description: 'desc' });

			expect(result).toEqual(mockModule);
			expect(get(modules)).toContainEqual(mockModule);
			expect(SettingsService.update).toHaveBeenCalledWith({
				moduleRefs: expect.arrayContaining([expect.objectContaining({ id: 'mod-1' })])
			});
		});

		it('should rollback if settings update fails', async () => {
			vi.mocked(ModuleService.create).mockResolvedValue(mockModule);
			vi.mocked(SettingsService.update).mockRejectedValue(new Error('Fail'));

			await expect(createModule({ name: 'New', description: 'desc' })).rejects.toThrow();
			expect(ModuleService.delete).toHaveBeenCalledWith('mod-1');
		});
	});

	describe('updateModule', () => {
		it('should update module content in store', async () => {
			modules.set([mockModule]);
			const updated = { ...mockModule, name: 'Updated' };
			vi.mocked(ModuleService.updateContent).mockResolvedValue(updated);

			await updateModule('mod-1', { name: 'Updated' });

			expect(get(modules)[0].name).toBe('Updated');
		});
	});

	describe('deleteModule', () => {
		it('should delete module and remove from stores', async () => {
			modules.set([mockModule]);
			appSettings.set({
				moduleRefs: [{ id: 'mod-1', sortOrder: 'a', enabled: true }]
			} as AppSettings);
			vi.mocked(SettingsService.update).mockResolvedValue({} as AppSettings);

			await deleteModule('mod-1');

			expect(get(modules)).toHaveLength(0);
			expect(get(appSettings)?.moduleRefs).toHaveLength(0);
			expect(get(moduleResources).has('mod-1')).toBe(false);
		});
	});

	describe('Nested Resource Management', () => {
		it('should create module lorebook', async () => {
			modules.set([mockModule]);
			const mockLb: Lorebook = {
				id: 'lb-1',
				name: 'LB',
				ownerId: 'mod-1',
				keys: [],
				content: '{}',
				insertionDepth: 0,
				enabled: true
			};
			vi.mocked(LorebookService.create).mockResolvedValue(mockLb);
			vi.mocked(ModuleService.update).mockResolvedValue({} as unknown as Module);

			await createModuleLorebook('mod-1', { name: 'LB' });

			expect(vi.mocked(ModuleService.update)).toHaveBeenCalledWith('mod-1', {
				lorebookRefs: expect.arrayContaining([{ id: 'lb-1', sortOrder: 'sort-order' }])
			});
		});

		it('should delete module lorebook', async () => {
			const modWithRef = { ...mockModule, lorebookRefs: [{ id: 'lb-1', sortOrder: 'a' }] };
			modules.set([modWithRef]);
			vi.mocked(ModuleService.update).mockResolvedValue({} as unknown as Module);

			await deleteModuleLorebook('mod-1', 'lb-1');

			expect(vi.mocked(ModuleService.update)).toHaveBeenCalledWith('mod-1', {
				lorebookRefs: []
			});
			expect(LorebookService.delete).toHaveBeenCalledWith('lb-1');
		});
	});

	describe('Folder Management', () => {
		it('should create module folder', async () => {
			modules.set([mockModule]);
			vi.mocked(ModuleService.update).mockResolvedValue({} as unknown as Module);

			const folder = await createModuleFolder('mod-1', 'lorebooks', 'New Folder');

			expect(folder.name).toBe('New Folder');
			expect(get(modules)[0].folders?.lorebooks).toContainEqual(folder);
		});
	});
});
