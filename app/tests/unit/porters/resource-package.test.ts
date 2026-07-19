import { describe, expect, it } from 'vitest';
import { importEntityList } from '$lib/porters/utils';
import type { CharJS } from '$lib/services';

describe('parent-owned package resources', () => {
    it('rekeys imported items and folders while preserving their contents', () => {
        const imported = importEntityList<CharJS>({
            refs: {
                charjs_0: {
                    id: 'charjs_0',
                    sortOrder: 'a',
                    folderId: 'folder_0',
                    name: 'Imported',
                    code: 'KeiAPI.onEvent("ready", () => {})',
                    enabled: true
                }
            },
            folders: {
                folder_0: { id: 'folder_0', name: 'Folder', sortOrder: 'a' }
            }
        });

        const [item] = Object.values(imported.refs);
        const [folder] = Object.values(imported.folders);
        expect(item.id).not.toBe('charjs_0');
        expect(folder.id).not.toBe('folder_0');
        expect(item.folderId).toBe(folder.id);
        expect(item).toMatchObject({ name: 'Imported', enabled: true });
    });
});
