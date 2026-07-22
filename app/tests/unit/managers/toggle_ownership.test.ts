import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setToggleValue } from '$lib/managers/toggle';
import type { ToggleControlItem } from '$lib/types/toggle';

const { mockGetActivePreset, mockGetModule, mockSaveModuleToggleItem, mockSavePresetToggleItem } =
    vi.hoisted(() => ({
        mockGetActivePreset: vi.fn(),
        mockGetModule: vi.fn(),
        mockSaveModuleToggleItem: vi.fn(),
        mockSavePresetToggleItem: vi.fn()
    }));

vi.mock('$lib/stores/content/merged', () => ({ getActiveModules: vi.fn() }));
vi.mock('$lib/stores/content/preset', () => ({
    getActivePreset: mockGetActivePreset,
    savePresetToggleItem: mockSavePresetToggleItem
}));
vi.mock('$lib/stores/content/module', () => ({
    getModule: mockGetModule,
    saveModuleToggleItem: mockSaveModuleToggleItem
}));

const checkbox: ToggleControlItem = {
    id: 'checkbox',
    kind: 'control',
    key: 'enabled',
    label: 'Enabled',
    sortOrder: 'a',
    control: { type: 'checkbox', value: false }
};

const select: ToggleControlItem = {
    id: 'select',
    kind: 'control',
    key: 'style',
    label: 'Style',
    sortOrder: 'a',
    control: {
        type: 'select',
        selectedOptionId: 'option-a',
        options: [
            { id: 'option-a', label: 'A' },
            { id: 'option-b', label: 'B' }
        ]
    }
};

describe('toggle value ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetActivePreset.mockReturnValue({
            id: 'preset-1',
            toggles: { refs: { checkbox }, folders: {} }
        });
        mockGetModule.mockResolvedValue({
            id: 'module-1',
            toggles: { refs: { select }, folders: {} }
        });
    });

    it('writes a Preset control value back to the Preset panel', async () => {
        await setToggleValue({ type: 'preset', id: 'preset-1' }, checkbox.id, true);

        expect(mockSavePresetToggleItem).toHaveBeenCalledWith('preset-1', {
            ...checkbox,
            control: { type: 'checkbox', value: true }
        });
        expect(mockSaveModuleToggleItem).not.toHaveBeenCalled();
    });

    it('writes a Module control value back to the Module panel', async () => {
        await setToggleValue({ type: 'module', id: 'module-1' }, select.id, '1');

        expect(mockSaveModuleToggleItem).toHaveBeenCalledWith('module-1', {
            ...select,
            control: { ...select.control, selectedOptionId: 'option-b' }
        });
        expect(mockSavePresetToggleItem).not.toHaveBeenCalled();
    });
});
