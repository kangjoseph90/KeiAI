import { describe, expect, it } from 'vitest';
import { getToggleValue } from '$lib/managers/toggle';
import type { ToggleControlItem } from '$lib/types/toggle';

const checkbox: ToggleControlItem = {
    id: 'checkbox',
    kind: 'control',
    key: 'enabled',
    label: 'Enabled',
    sortOrder: 'a',
    control: { type: 'checkbox', value: false }
};

describe('toggle values', () => {
    it('reads a control value', () => {
        expect(getToggleValue(checkbox)).toBe(false);
    });
});
