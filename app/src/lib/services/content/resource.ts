import type { LLMRole } from '$lib/types/models/llm';
import type { EntityListConfig, OrderedRef } from '$lib/types/refs';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { generateId } from '$lib/utils/id';

export interface LorebookFields {
    name: string;
    key: string;
    secondKey: string;
    content: string;
    depth: number;
    order: number;
    alwaysActive: boolean;
    disabled: boolean;
    role: LLMRole;
    useRegex: boolean;
    useMultipleKeys: boolean;
    scanDepth?: number;
    probability: number;
    recursive: boolean;
    noRecursiveSearch: boolean;
}

export interface Lorebook extends OrderedRef, LorebookFields {}

export interface ScriptFields {
    type: 'regex';
    name: string;
    regex: string;
    replacement: string;
    phase: 'input' | 'request' | 'output' | 'display';
    flag: string;
    order: number;
    repeat: number;
    enabled: boolean;
}

export interface Script extends OrderedRef, ScriptFields {}

export interface CharJSFields {
    name: string;
    code: string;
    enabled: boolean;
}

export interface CharJS extends OrderedRef, CharJSFields {}

export const defaultLorebookFields: LorebookFields = {
    name: 'New Lorebook',
    key: '',
    secondKey: '',
    content: '',
    depth: 1,
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

export const defaultScriptFields: ScriptFields = {
    type: 'regex',
    name: 'New Script',
    regex: '',
    replacement: '',
    phase: 'display',
    flag: 'g',
    order: 100,
    repeat: 1,
    enabled: true
};

export const defaultCharJSFields: CharJSFields = {
    name: 'New Script',
    code: '',
    enabled: true
};
