import { AppError } from '$lib/types/errors';
import { isRecord } from '../utils';
import type { RisuRegexScript } from '../risu/script';
import type { SerializedKeiCharacterPackageV1 } from './types';

export interface CharacterCardV3 {
    spec: 'chara_card_v3';
    spec_version: '3.0';
    data: CharacterCardV3Data;
}

export interface CharacterCardV3Data {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    alternate_greetings: string[];
    mes_example: string;
    creator_notes: string;
    system_prompt: string;
    post_history_instructions: string;
    character_book?: CharacterBook;
    assets?: CardAsset[];
    tags: string[];
    creator: string;
    character_version: string;
    extensions: CharacterCardExtensions;
    group_only_greetings: string[];
}

export interface CharacterCardExtensions {
    risuai?: RisuExtension;
    keiai?: SerializedKeiCharacterPackageV1;
    [key: string]: unknown;
}

export interface RisuExtension {
    customScripts?: RisuRegexScript[];
    triggerscript?: unknown[];
    defaultVariables?: string;
    lowLevelAccess?: boolean;
    [key: string]: unknown;
}

export interface CharacterBook {
    scan_depth?: number;
    token_budget?: number;
    recursive_scanning?: boolean;
    extensions: Record<string, unknown>;
    entries: CharacterBookEntry[];
}

export interface CharacterBookEntry {
    keys: string[];
    content: string;
    extensions: Record<string, unknown>;
    enabled: boolean;
    insertion_order: number;
    use_regex: boolean;
    constant?: boolean;
    name?: string;
    comment?: string;
    selective?: boolean;
    secondary_keys?: string[];
    mode?: string;
}

export interface CardAsset {
    type: string;
    uri: string;
    name: string;
    ext: string;
}

export function parseCharacterCardV3(value: unknown): CharacterCardV3 {
    if (
        !isRecord(value) ||
        value.spec !== 'chara_card_v3' ||
        value.spec_version !== '3.0' ||
        !isRecord(value.data)
    ) {
        throw new AppError('INVALID_INPUT', 'Input is not a Character Card V3');
    }
    const card = value as unknown as CharacterCardV3;
    card.data.alternate_greetings ??= [];
    card.data.tags ??= [];
    card.data.extensions ??= {};
    card.data.group_only_greetings ??= [];
    return card;
}
