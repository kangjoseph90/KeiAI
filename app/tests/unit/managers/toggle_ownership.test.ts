import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setToggleValue } from '$lib/managers/toggle';
import type { ToggleControlItem } from '$lib/types/toggle';

const { mockGetActivePreset, mockGetModule, mockUpdateModule, mockUpdatePresetContent } =
    vi.hoisted(() => ({
        mockGetActivePreset: vi.fn(),
        mockGetModule: vi.fn(),
        mockUpdateModule: vi.fn(),
        mockUpdatePresetContent: vi.fn()
    }));

vi.mock('$lib/stores/content/merged', () => ({ getActiveModuleIds: vi.fn() }));
vi.mock('$lib/stores/content/preset', () => ({
    getActivePreset: mockGetActivePreset,
    updatePresetContent: mockUpdatePresetContent
}));
vi.mock('$lib/stores/content/module', () => ({
    getModule: mockGetModule,
    updateModule: mockUpdateModule
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

        expect(mockUpdatePresetContent).toHaveBeenCalledWith('preset-1', {
            toggles: {
                refs: { checkbox: { ...checkbox, control: { type: 'checkbox', value: true } } }
            }
        });
        expect(mockUpdateModule).not.toHaveBeenCalled();
    });

    it('writes a Module control value back to the Module panel', async () => {
        await setToggleValue({ type: 'module', id: 'module-1' }, select.id, '1');

        expect(mockUpdateModule).toHaveBeenCalledWith('module-1', {
            toggles: {
                refs: {
                    select: {
                        ...select,
                        control: { ...select.control, selectedOptionId: 'option-b' }
                    }
                }
            }
        });
        expect(mockUpdatePresetContent).not.toHaveBeenCalled();
    });
});
