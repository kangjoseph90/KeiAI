import type { LorebookFields } from '$lib/services';
import type { CharacterBookEntry } from '../character/ccv3';
import { normalizeCharacterMacros } from '../utils';
import type { RisuInternalLorebook } from './module';

const DECORATOR_RE = /^\s*@@([a-z_]+)(?:\s+(.*?))?\s*$/i;

export function addRisuLorebookDecorators(lorebook: LorebookFields): string {
    const decorators: string[] = [];
    if (lorebook.depth !== 0) decorators.push(`@@depth ${lorebook.depth}`);
    if (lorebook.role !== 'system') decorators.push(`@@role ${lorebook.role}`);
    if (lorebook.scanDepth !== undefined) decorators.push(`@@scan_depth ${lorebook.scanDepth}`);
    if (lorebook.probability !== 100) decorators.push(`@@probability ${lorebook.probability}`);
    decorators.push(lorebook.recursive ? '@@recursive' : '@@unrecursive');
    if (lorebook.noRecursiveSearch) decorators.push('@@no_recursive_search');

    if (decorators.length === 0) return lorebook.content;
    return `${decorators.join('\n')}\n${lorebook.content}`;
}

export function readRisuLorebookDecorators(lorebook: LorebookFields): LorebookFields {
    const lines = lorebook.content.split(/\r?\n/);
    const next: LorebookFields = { ...lorebook };
    let contentStart = 0;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.trim() === '') {
            contentStart = index + 1;
            continue;
        }

        const match = DECORATOR_RE.exec(line);
        if (!match) break;
        if (!applyDecorator(next, match[1].toLowerCase(), match[2] ?? '')) break;
        contentStart = index + 1;
    }

    return {
        ...next,
        content: lines.slice(contentStart).join('\n')
    };
}

export function risuInternalLorebookToKei(
    lorebook: RisuInternalLorebook,
    index: number
): LorebookFields & { id: string } {
    const fields: LorebookFields = {
        name: lorebook.comment ?? `Lorebook ${index + 1}`,
        key: lorebook.key ?? '',
        secondKey: lorebook.secondkey ?? '',
        content: normalizeCharacterMacros(lorebook.content ?? ''),
        depth: 1,
        order: lorebook.insertorder ?? 100,
        alwaysActive: lorebook.alwaysActive ?? false,
        disabled: false,
        role: 'system',
        useRegex: lorebook.useRegex ?? false,
        useMultipleKeys: lorebook.selective ?? false,
        probability: 100,
        recursive: false,
        noRecursiveSearch: false
    };
    return { id: `lorebook_${index}`, ...readRisuLorebookDecorators(fields) };
}

export function keiLorebookToRisuInternal(lorebook: LorebookFields): RisuInternalLorebook {
    return {
        key: lorebook.key,
        secondkey: lorebook.secondKey,
        insertorder: lorebook.order,
        comment: lorebook.name,
        content: addRisuLorebookDecorators(lorebook),
        mode: lorebook.alwaysActive ? 'constant' : lorebook.useMultipleKeys ? 'multiple' : 'normal',
        alwaysActive: lorebook.alwaysActive,
        selective: lorebook.useMultipleKeys,
        useRegex: lorebook.useRegex
    };
}

export function keiLorebookToRisuCardEntry(lorebook: LorebookFields): CharacterBookEntry {
    return {
        keys: splitKeys(lorebook.key),
        secondary_keys: lorebook.useMultipleKeys ? splitKeys(lorebook.secondKey) : undefined,
        content: addRisuLorebookDecorators(lorebook),
        extensions: {},
        enabled: !lorebook.disabled,
        insertion_order: lorebook.order,
        use_regex: lorebook.useRegex,
        constant: lorebook.alwaysActive,
        selective: lorebook.useMultipleKeys,
        name: lorebook.name,
        comment: lorebook.name,
        mode: lorebook.useMultipleKeys ? 'multiple' : lorebook.alwaysActive ? 'constant' : 'normal'
    };
}

function applyDecorator(lorebook: LorebookFields, name: string, value: string): boolean {
    if (name === 'end') {
        lorebook.depth = 0;
        return true;
    }
    if (name === 'depth') return applyInt(value, (next) => (lorebook.depth = next));
    if (name === 'role') return applyRole(value, (next) => (lorebook.role = next));
    if (name === 'scan_depth') return applyInt(value, (next) => (lorebook.scanDepth = next));
    if (name === 'probability') return applyInt(value, (next) => (lorebook.probability = next));
    if (name === 'recursive') {
        lorebook.recursive = true;
        return true;
    }
    if (name === 'unrecursive') {
        lorebook.recursive = false;
        return true;
    }
    if (name === 'no_recursive_search') {
        lorebook.noRecursiveSearch = true;
        return true;
    }
    return false;
}

function applyInt(value: string, apply: (value: number) => void): boolean {
    const next = Number.parseInt(value, 10);
    if (Number.isNaN(next)) return false;
    apply(next);
    return true;
}

function applyRole(value: string, apply: (value: LorebookFields['role']) => void): boolean {
    const next = value.trim();
    if (next !== 'system' && next !== 'user' && next !== 'assistant') return false;
    apply(next);
    return true;
}

function splitKeys(value: string): string[] {
    return value
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);
}
