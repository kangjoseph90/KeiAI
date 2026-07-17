import { describe, expect, it } from 'vitest';
import { getToggleValue, normalizeToggleValue, serializeToggleValue } from '$lib/managers/toggle';
import type { ToggleControlItem, ToggleSelectControl } from '$lib/types/toggle';

const checkbox: ToggleControlItem = {
    id: 'checkbox',
    kind: 'control',
    key: 'enabled',
    label: 'Enabled',
    sortOrder: 'a',
    control: { type: 'checkbox', value: false }
};

const select: ToggleControlItem & { control: ToggleSelectControl } = {
    id: 'select',
    kind: 'control',
    key: 'style',
    label: 'Style',
    sortOrder: 'b',
    control: {
        type: 'select',
        selectedOptionId: 'option-b',
        options: [
            { id: 'option-a', label: 'A' },
            { id: 'option-b', label: 'B' }
        ]
    }
};

describe('toggle values', () => {
    it('normalizes and serializes checkbox values', () => {
        expect(getToggleValue(checkbox)).toBe(false);
        expect(normalizeToggleValue(checkbox, '1')).toBe(true);
        expect(
            serializeToggleValue({ ...checkbox, control: { type: 'checkbox', value: true } })
        ).toBe('1');
        expect(() => normalizeToggleValue(checkbox, 'maybe')).toThrow();
    });

    it('stores select option ids and exposes portable option values', () => {
        expect(normalizeToggleValue(select, '1')).toBe('option-b');
        expect(serializeToggleValue(select)).toBe('1');
        expect(
            serializeToggleValue({
                ...select,
                control: { ...select.control, selectedOptionId: 'missing' }
            })
        ).toBe('null');
    });
});
