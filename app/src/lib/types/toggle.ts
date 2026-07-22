import type { EntityListConfig, OrderedRef } from './refs';

export type TogglePanel = EntityListConfig<ToggleItem>;

export interface ToggleControlItem extends OrderedRef {
    kind: 'control';
    key: string;
    label: string;
    control: ToggleControl;
}

export interface ToggleTextItem extends OrderedRef {
    kind: 'text';
    text: string;
}

export interface ToggleDividerItem extends OrderedRef {
    kind: 'divider';
    label?: string;
}

export type ToggleItem = ToggleControlItem | ToggleTextItem | ToggleDividerItem;

export interface ToggleCheckboxControl {
    type: 'checkbox';
    value: boolean;
}

export interface ToggleSelectOption {
    id: string;
    label: string;
}

export interface ToggleSelectControl {
    type: 'select';
    options: ToggleSelectOption[];
    selectedOptionId: string;
}

export interface ToggleTextControl {
    type: 'text';
    multiline: boolean;
    value: string;
}

export type ToggleControl = ToggleCheckboxControl | ToggleSelectControl | ToggleTextControl;

export type ToggleOwner = { type: 'preset'; id: string } | { type: 'module'; id: string };

export interface ResolvedToggleSource {
    owner: ToggleOwner;
    name: string;
    panel: TogglePanel;
}
