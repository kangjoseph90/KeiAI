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
    moveModuleItem,
    createModuleCharJS,
    deleteModuleCharJS
} from '$lib/stores/content/module';
import { modules, appSettings, moduleResources } from '$lib/stores/state';
import {
    ModuleService,
    LorebookService,
    ScriptService,
    CharJSService,
    SettingsService
} from '$lib/services';
import { AppError } from '$lib/types/errors';
import type { Module, ModuleContent, Lorebook, Script, CharJS, AppSettings } from '$lib/services';
import type { FolderDef } from '$lib/types/refs';
import { makeSettings } from '../../utils';
import { deepMerge } from '$lib/utils/defaults';

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
    CharJSService: {
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

// Mock settings store
vi.mock('$lib/stores/content/settings', () => ({
    getAppSettings: vi.fn(),
    updateSettings: vi.fn()
}));

import { getAppSettings, updateSettings } from '$lib/stores/content/settings';

describe('Module Store', () => {
    const mockModule: Module = {
        id: 'mod-1',
        name: 'Test Module',
        description: 'Description',
        allowLowLevel: false,
        lorebooks: { refs: {}, folders: {} },
        scripts: { refs: {}, folders: {} },
        charjs: { refs: {}, folders: {} },
        assets: []
    };

    beforeEach(() => {
        vi.clearAllMocks();
        modules.clear();
        appSettings.set(makeSettings({ theme: 'dark' }));
        moduleResources.set(new Map());
        vi.mocked(getAppSettings).mockImplementation(async () => get(appSettings)!);
        vi.mocked(updateSettings).mockImplementation(async (changes) => {
            appSettings.update((s) => (s ? deepMerge(s, changes) : s));
        });
    });

    describe('loadModules', () => {
        it('should load modules and their resources', async () => {
            vi.mocked(ModuleService.list).mockResolvedValue([mockModule]);
            vi.mocked(LorebookService.listByOwner).mockResolvedValue([]);
            vi.mocked(ScriptService.listByOwner).mockResolvedValue([]);
            vi.mocked(CharJSService.listByOwner).mockResolvedValue([]);

            await loadModules();

            expect(get(modules)).toEqual([mockModule]);
            expect(get(moduleResources).has('mod-1')).toBe(true);
            expect(ModuleService.list).toHaveBeenCalled();
        });
    });

    describe('createModule', () => {
        it('should create module and update settings', async () => {
            vi.mocked(ModuleService.create).mockResolvedValue(mockModule);

            const result = await createModule({ name: 'New', description: 'desc' });

            expect(result).toEqual(mockModule);
            expect(get(modules)).toContainEqual(mockModule);
            expect(updateSettings).toHaveBeenCalledWith(
                expect.objectContaining({
                    modules: expect.objectContaining({
                        refs: expect.objectContaining({
                            'mod-1': expect.objectContaining({ id: 'mod-1', enabled: true })
                        })
                    })
                })
            );
        });

        it('should rollback if settings update fails', async () => {
            vi.mocked(ModuleService.create).mockResolvedValue(mockModule);
            vi.mocked(updateSettings).mockRejectedValueOnce(new Error('Fail'));

            await expect(createModule({ name: 'New', description: 'desc' })).rejects.toThrow();
            expect(ModuleService.delete).toHaveBeenCalledWith('mod-1');
        });
    });

    describe('updateModule', () => {
        it('should update module content in store', async () => {
            modules.setAll([mockModule]);
            const updated = { ...mockModule, name: 'Updated' };
            vi.mocked(ModuleService.update).mockResolvedValue(updated);

            await updateModule('mod-1', { name: 'Updated' });

            expect(get(modules)[0].name).toBe('Updated');
        });
    });

    describe('deleteModule', () => {
        it('should delete module and remove from stores', async () => {
            modules.setAll([mockModule]);
            appSettings.set(
                makeSettings({
                    modules: { refs: { 'mod-1': { id: 'mod-1', sortOrder: 'a', enabled: true } } }
                })
            );
            await deleteModule('mod-1');

            expect(get(modules)).toHaveLength(0);
            expect(get(appSettings)?.modules.refs['mod-1']).toBeUndefined();
            expect(get(moduleResources).has('mod-1')).toBe(false);
        });
    });

    describe('Nested Resource Management', () => {
        it('should create module lorebook', async () => {
            modules.setAll([mockModule]);
            const mockLb: Lorebook = {
                id: 'lb-1',
                name: 'LB',
                ownerId: 'mod-1',
                key: '',
                secondKey: '',
                content: '{}',
                depth: 0,
                order: 100,
                alwaysActive: false,
                disabled: false,
                role: 'system',
                useRegex: false,
                useMultipleKeys: false,
                probability: 100,
                recursive: false,
                noRecursiveSearch: false
            };
            vi.mocked(LorebookService.create).mockResolvedValue(mockLb);
            vi.mocked(ModuleService.update).mockResolvedValue({} as unknown as Module);

            await createModuleLorebook('mod-1', { name: 'LB' });

            expect(vi.mocked(ModuleService.update)).toHaveBeenCalledWith('mod-1', {
                lorebooks: { refs: { 'lb-1': { id: 'lb-1', sortOrder: 'sort-order' } } }
            });
        });

        it('should delete module lorebook', async () => {
            const modWithRef = {
                ...mockModule,
                lorebooks: { refs: { 'lb-1': { id: 'lb-1', sortOrder: 'a' } }, folders: {} }
            };
            modules.setAll([modWithRef]);
            vi.mocked(ModuleService.update).mockResolvedValue({} as unknown as Module);

            await deleteModuleLorebook('mod-1', 'lb-1');

            expect(vi.mocked(ModuleService.update)).toHaveBeenCalledWith('mod-1', {
                lorebooks: { refs: { 'lb-1': undefined } }
            });
            expect(LorebookService.delete).toHaveBeenCalledWith('lb-1');
        });

        it('should create module charjs', async () => {
            modules.setAll([mockModule]);
            const mockCjs: CharJS = {
                id: 'cjs-1',
                name: 'New Script',
                ownerId: 'mod-1',
                code: '',
                enabled: true
            };
            vi.mocked(CharJSService.create).mockResolvedValue(mockCjs);
            vi.mocked(ModuleService.update).mockResolvedValue({} as unknown as Module);

            await createModuleCharJS('mod-1', { name: 'New Script' });

            expect(vi.mocked(ModuleService.update)).toHaveBeenCalledWith('mod-1', {
                charjs: { refs: { 'cjs-1': { id: 'cjs-1', sortOrder: 'sort-order' } } }
            });
        });

        it('should delete module charjs', async () => {
            const modWithRef = {
                ...mockModule,
                charjs: { refs: { 'cjs-1': { id: 'cjs-1', sortOrder: 'a' } }, folders: {} }
            };
            modules.setAll([modWithRef]);
            vi.mocked(ModuleService.update).mockResolvedValue({} as unknown as Module);

            await deleteModuleCharJS('mod-1', 'cjs-1');

            expect(vi.mocked(ModuleService.update)).toHaveBeenCalledWith('mod-1', {
                charjs: { refs: { 'cjs-1': undefined } }
            });
            expect(CharJSService.delete).toHaveBeenCalledWith('cjs-1');
        });
    });

    describe('Folder Management', () => {
        it('should create module folder', async () => {
            modules.setAll([mockModule]);
            vi.mocked(ModuleService.update).mockImplementation(
                async (_id, changes) =>
                    ({
                        ...mockModule,
                        ...changes
                    }) as unknown as Module
            );

            const folder = await createModuleFolder('mod-1', 'lorebooks', 'New Folder');

            expect(folder.name).toBe('New Folder');
            expect(get(modules)[0].lorebooks?.folders?.['new-id']).toEqual(folder);
        });
    });
});
