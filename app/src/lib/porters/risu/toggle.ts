import type { ToggleControlItem, ToggleItem, TogglePanel } from '$lib/types/toggle';
import { generateId } from '$lib/utils/id';
import { compareSortOrder } from '$lib/utils/ordering';
import { sortOrder } from '../utils';

export function readRisuTogglePanel(value: string): TogglePanel {
    const panel: TogglePanel = { refs: {}, folders: {} };
    const folderStack: string[] = [];
    for (const [index, line] of value.split(/\r?\n/).entries()) {
        const [key = '', label = '', type = '', optionText = ''] = line.split('=');
        if (type === 'groupEnd') {
            folderStack.pop();
            continue;
        }
        const id = generateId();
        const itemSortOrder = sortOrder(index);
        if (type === 'group') {
            panel.folders[id] = {
                id,
                name: label || key || 'Group',
                sortOrder: itemSortOrder,
                parentId: folderStack.at(-1)
            };
            folderStack.push(id);
            continue;
        }

        const folderId = folderStack.at(-1);
        let item: ToggleItem | null = null;
        if (type === 'caption') {
            item = { id, kind: 'text', text: label || key, sortOrder: itemSortOrder, folderId };
        } else if (type === 'divider') {
            item = {
                id,
                kind: 'divider',
                label: label || key,
                sortOrder: itemSortOrder,
                folderId
            };
        } else if (key && label) {
            item = readControl(id, key, label, type, optionText, itemSortOrder, folderId);
        }
        if (item) panel.refs[id] = item;
    }
    return panel;
}

export function writeRisuTogglePanel(panel: TogglePanel): string {
    const lines: string[] = [];
    appendLevel(panel, undefined, lines);
    return lines.join('\n');
}

function appendLevel(panel: TogglePanel, parentId: string | undefined, lines: string[]): void {
    const entries = [
        ...Object.values(panel.folders)
            .filter((folder) => folder.parentId === parentId)
            .map((folder) => ({ kind: 'folder' as const, value: folder })),
        ...Object.values(panel.refs)
            .filter((item) => item.folderId === parentId)
            .map((item) => ({ kind: 'item' as const, value: item }))
    ].sort((a, b) => compareSortOrder(a.value.sortOrder, b.value.sortOrder));

    for (const entry of entries) {
        if (entry.kind === 'folder') {
            lines.push(`=${entry.value.name}=group=`);
            appendLevel(panel, entry.value.id, lines);
            lines.push('==groupEnd=');
        } else {
            lines.push(writeItem(entry.value));
        }
    }
}

function writeItem(item: ToggleItem): string {
    if (item.kind === 'text') return `=${item.text}=caption=`;
    if (item.kind === 'divider') return `=${item.label ?? ''}=divider=`;
    if (item.control.type === 'select') {
        return `${item.key}=${item.label}=select=${item.control.options.map((option) => option.label).join(',')}`;
    }
    if (item.control.type === 'text') {
        return `${item.key}=${item.label}=${item.control.multiline ? 'textarea' : 'text'}=`;
    }
    return `${item.key}=${item.label}=checkbox=`;
}

function readControl(
    id: string,
    key: string,
    label: string,
    type: string,
    optionText: string,
    sortOrder: string,
    folderId?: string
): ToggleControlItem {
    if (type === 'select') {
        const options = optionText.split(',').map((optionLabel) => ({
            id: generateId(),
            label: optionLabel.trim()
        }));
        return {
            id,
            kind: 'control',
            key,
            label,
            sortOrder,
            folderId,
            control: { type: 'select', options, selectedOptionId: options[0]?.id ?? '' }
        };
    }
    if (type === 'text' || type === 'textarea') {
        return {
            id,
            kind: 'control',
            key,
            label,
            sortOrder,
            folderId,
            control: { type: 'text', multiline: type === 'textarea', value: '' }
        };
    }
    return {
        id,
        kind: 'control',
        key,
        label,
        sortOrder,
        folderId,
        control: { type: 'checkbox', value: false }
    };
}
