import { compressSync, decompressSync } from 'fflate';
import { decode, encode } from 'msgpackr';
import type { LLMRole } from '$lib/types/models/llm';
import { AppError } from '$lib/types/errors';
import type { PresetCustomToggle } from '$lib/services';
import { generateId } from '$lib/utils/id';
import type { RisuRegexScript } from '../risu/script';
import { decodeRPack, encodeRPack } from '../risu/rpack';
import { keiScriptToRisu, risuScriptToKei } from '../risu/script';
import type { KeiPresetPackageV1 } from './types';
import {
    isRecord,
    normalizeCharacterMacros,
    readDefaultVariables,
    refs,
    sortOrder,
    writeDefaultVariables
} from '../utils';

import { compareSortOrder } from '../../utils/ordering';

const TEXT_ENCODER = new TextEncoder();
const RISU_PRESET_KEY = 'risupreset';

type RisuRole = 'user' | 'bot' | 'system';

type RisuPromptItem =
    | {
          type: 'plain' | 'jailbreak' | 'cot';
          type2?: string;
          text?: string;
          role?: RisuRole;
          name?: string;
      }
    | { type: 'chatML'; text?: string; name?: string }
    | {
          type: 'persona' | 'description' | 'lorebook' | 'postEverything' | 'memory';
          innerFormat?: string;
          name?: string;
      }
    | { type: 'authornote'; innerFormat?: string; defaultText?: string; name?: string }
    | { type: 'chat'; rangeStart?: number; rangeEnd?: number | 'end'; name?: string }
    | { type: 'cache'; name?: string; depth?: number; role?: RisuRole | 'all' };

interface RisuPreset {
    name?: string;
    mainPrompt?: string;
    jailbreak?: string;
    globalNote?: string;
    temperature?: number;
    maxContext?: number;
    maxResponse?: number;
    frequencyPenalty?: number;
    PresensePenalty?: number;
    aiModel?: string;
    subModel?: string;
    top_p?: number;
    promptTemplate?: RisuPromptItem[];
    keiai?: KeiPresetPackageV1;
    promptPreprocess?: boolean;
    bias?: [string, number][];
    formatingOrder?: string[];
    regex?: RisuRegexScript[];
    customPromptTemplateToggle?: string;
    templateDefaultVariables?: string;
}

export async function readRisuPreset(
    bytes: Uint8Array,
    packed: boolean
): Promise<KeiPresetPackageV1> {
    const data = packed ? decodeRPack(bytes) : bytes;
    const envelope = decode(decompressSync(data)) as unknown;
    if (!isRecord(envelope) || envelope.type !== 'preset') {
        throw new AppError('INVALID_INPUT', 'Invalid Risu preset');
    }

    const encrypted = envelope.preset ?? envelope.pres;
    if (!(encrypted instanceof Uint8Array)) {
        throw new AppError('INVALID_INPUT', 'Risu preset is missing payload');
    }

    const preset = decode(new Uint8Array(await decrypt(encrypted, RISU_PRESET_KEY))) as unknown;
    if (!isRecord(preset)) {
        throw new AppError('INVALID_INPUT', 'Invalid Risu preset payload');
    }

    if (isKeiPresetPackage(preset.keiai)) return preset.keiai;
    return risuPresetToKeiPreset(preset as RisuPreset);
}

export async function writeRisuPreset(pkg: KeiPresetPackageV1): Promise<Uint8Array> {
    const preset = keiPresetToRisuPreset(pkg);
    const encrypted = new Uint8Array(await encrypt(encode(preset), RISU_PRESET_KEY));
    const envelope = encode({
        presetVersion: 2,
        type: 'preset',
        preset: encrypted
    });
    return encodeRPack(compressSync(envelope));
}

export function readRisuPresetJson(value: unknown): KeiPresetPackageV1 {
    if (isKeiPresetPackage(value)) return value;
    if (!isRecord(value)) throw new AppError('INVALID_INPUT', 'Invalid preset JSON');
    if (isKeiPresetPackage(value.keiai)) return value.keiai;
    return risuPresetToKeiPreset(value as RisuPreset);
}

function risuPresetToKeiPreset(risu: RisuPreset): KeiPresetPackageV1 {
    const promptItems = readPromptItems(risu);
    const hasPostEverything = promptItems.some((item) => item.type === 'postEverything');
    const temperature = readRisuPercent(risu.temperature);
    const frequencyPenalty = readRisuPercent(risu.frequencyPenalty);
    const presencePenalty = readRisuPercent(risu.PresensePenalty);
    const topP = readRisuDisabledNumber(risu.top_p);
    const scripts = (risu.regex ?? []).map(risuScriptToKei);
    const customToggles = readRisuCustomToggles(risu.customPromptTemplateToggle ?? '');
    const globalVariables = initializeRisuToggleVariables(customToggles);
    const promptBlocks = Object.fromEntries(
        promptItems
            .map((item, index) => risuPromptToKeiBlock(item, index, hasPostEverything))
            .filter((block) => block != null)
            .map((block, index) => [
                `block_${index}`,
                {
                    id: `block_${index}`,
                    sortOrder: sortOrder(index),
                    enabled: true,
                    ...block
                }
            ])
    );

    return {
        version: 1,
        kind: 'keiai.preset',
        preset: {
            name: risu.name ?? 'Imported Risu Preset',
            description: '',
            chatModel: {
                id: risu.aiModel ?? 'openai::gpt-5.4',
                provider: 'openai',
                parameters: {
                    ...(temperature != null ? { temperature } : {}),
                    ...(frequencyPenalty != null ? { frequency_penalty: frequencyPenalty } : {}),
                    ...(presencePenalty != null ? { presence_penalty: presencePenalty } : {}),
                    ...(topP != null ? { top_p: topP } : {})
                }
            },
            auxModel: {
                id: risu.subModel ?? risu.aiModel ?? 'openai::gpt-5.4',
                provider: 'openai',
                parameters: {}
            },
            promptBlocks,
            maxResponse: readRisuDisabledNumber(risu.maxResponse) ?? 300,
            maxContext: readRisuDisabledNumber(risu.maxContext) ?? 4000,
            lorebookRatio: 0.2,
            memoryRatio: 0.2,
            lorebookScanDepth: 5,
            defaultVariables: readDefaultVariables(risu.templateDefaultVariables),
            globalVariables,
            customToggles,
            scripts: refs(scripts)
        },
        scripts
    };
}

function keiPresetToRisuPreset(pkg: KeiPresetPackageV1): RisuPreset {
    const parameters = pkg.preset.chatModel.parameters ?? {};
    return {
        name: pkg.preset.name,
        mainPrompt: '',
        jailbreak: '',
        globalNote: '',
        temperature: readPercent(parameters.temperature, 80),
        maxContext: pkg.preset.maxContext,
        maxResponse: pkg.preset.maxResponse,
        frequencyPenalty: readPercent(parameters.frequency_penalty, 70),
        PresensePenalty: readPercent(parameters.presence_penalty, 70),
        aiModel: pkg.preset.chatModel.id,
        subModel: pkg.preset.auxModel.id,
        top_p: typeof parameters.top_p === 'number' ? parameters.top_p : 1,
        promptPreprocess: false,
        bias: [],
        formatingOrder: [],
        regex: pkg.scripts.map(keiScriptToRisu),
        customPromptTemplateToggle: writeRisuCustomToggles(pkg.preset.customToggles),
        templateDefaultVariables: writeDefaultVariables(pkg.preset.defaultVariables),
        promptTemplate: Object.values(pkg.preset.promptBlocks)
            .sort((a, b) => compareSortOrder(a.sortOrder, b.sortOrder))
            .filter((block) => block.enabled)
            .map(keiBlockToRisuPrompt),
        keiai: pkg
    };
}

function readRisuCustomToggles(value: string): Record<string, PresetCustomToggle> {
    const lines = value.split(/\r?\n/);
    return Object.fromEntries(
        lines
            .map((line, index): PresetCustomToggle | null => {
                const id = generateId();
                const [key, label, type, optionText] = line.split('=');
                if (
                    type === 'group' ||
                    type === 'groupEnd' ||
                    type === 'caption' ||
                    type === 'divider'
                ) {
                    return { id, sortOrder: sortOrder(index), key, label, type };
                }
                if (!key || !label) return null;
                if (type === 'select') {
                    return {
                        id,
                        sortOrder: sortOrder(index),
                        key,
                        label,
                        type,
                        options: optionText?.split(',').map((item) => item.trim()) ?? []
                    };
                }
                if (type === 'text' || type === 'textarea')
                    return { id, sortOrder: sortOrder(index), key, label, type };
                return { id, sortOrder: sortOrder(index), key, label, type: 'checkbox' };
            })
            .filter((toggle): toggle is PresetCustomToggle => toggle !== null)
            .map((toggle) => [toggle.id, toggle])
    );
}

function writeRisuCustomToggles(toggles: Record<string, PresetCustomToggle>): string {
    return Object.values(toggles)
        .sort((a, b) => compareSortOrder(a.sortOrder, b.sortOrder))
        .map((toggle) => {
            if (toggle.type === 'checkbox') return `${toggle.key}=${toggle.label}`;
            if (toggle.type === 'select')
                return `${toggle.key}=${toggle.label}=select=${toggle.options.join(',')}`;
            return `${toggle.key ?? ''}=${toggle.label ?? ''}=${toggle.type}`;
        })
        .join('\n');
}

function initializeRisuToggleVariables(
    toggles: Record<string, PresetCustomToggle>
): Record<string, string> {
    const variables: Record<string, string> = {};
    for (const toggle of Object.values(toggles)) {
        if (!('key' in toggle) || !toggle.key) continue;
        variables[`toggle_${toggle.key}`] =
            toggle.type === 'select' ? '0' : toggle.type === 'checkbox' ? '0' : '';
    }
    return variables;
}

function readPromptItems(risu: RisuPreset): RisuPromptItem[] {
    if (Array.isArray(risu.promptTemplate)) return risu.promptTemplate;
    return [
        { type: 'plain', type2: 'main', text: risu.mainPrompt ?? '', role: 'system' },
        { type: 'description' },
        { type: 'persona' },
        { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
        { type: 'lorebook' },
        { type: 'jailbreak', type2: 'normal', text: risu.jailbreak ?? '', role: 'system' },
        { type: 'plain', type2: 'globalNote', text: risu.globalNote ?? '', role: 'system' },
        { type: 'authornote' }
    ];
}

function risuPromptToKeiBlock(item: RisuPromptItem, index: number, hasPostEverything: boolean) {
    const name = item.name ?? promptName(item.type, index);
    if (item.type === 'description')
        return {
            name,
            type: 'character' as const,
            role: 'system' as LLMRole,
            format: optionalFormat(item.innerFormat)
        };
    if (item.type === 'persona')
        return {
            name,
            type: 'persona' as const,
            role: 'system' as LLMRole,
            format: optionalFormat(item.innerFormat)
        };
    if (item.type === 'lorebook') {
        return {
            name,
            type: 'lorebook' as const,
            ...(hasPostEverything ? { minDepth: 1 } : {})
        };
    }
    if (item.type === 'postEverything') {
        return { name, type: 'lorebook' as const, maxDepth: 0 };
    }
    if (item.type === 'memory')
        return {
            name,
            type: 'memory' as const,
            role: 'system' as LLMRole,
            format: optionalFormat(item.innerFormat)
        };
    if (item.type === 'authornote')
        return {
            name,
            type: 'chatNote' as const,
            role: 'system' as LLMRole,
            format: optionalFormat(item.innerFormat)
        };
    if (item.type === 'chatML' || item.type === 'cache') return null;
    if (item.type === 'chat') {
        return {
            name,
            type: 'history' as const,
            ...(item.rangeStart === -1000 ? {} : { start: item.rangeStart }),
            ...(item.rangeEnd === 'end' ? {} : { end: item.rangeEnd })
        };
    }
    if ('type2' in item && item.type2 === 'globalNote') {
        return {
            name,
            type: 'characterNote' as const,
            role: risuRoleToKei(item.role),
            format: optionalFormat(item.text)
        };
    }
    return {
        name,
        type: 'text' as const,
        role: risuRoleToKei('role' in item ? item.role : undefined),
        content: 'text' in item ? normalizeCharacterMacros(item.text ?? '') : ''
    };
}

function keiBlockToRisuPrompt(
    block: KeiPresetPackageV1['preset']['promptBlocks'][string]
): RisuPromptItem {
    if (block.type === 'character')
        return { type: 'description', innerFormat: block.format, name: block.name };
    if (block.type === 'persona')
        return { type: 'persona', innerFormat: block.format, name: block.name };
    if (block.type === 'lorebook') {
        if (block.maxDepth === 0) return { type: 'postEverything', name: block.name };
        return { type: 'lorebook', innerFormat: block.format, name: block.name };
    }
    if (block.type === 'memory')
        return { type: 'memory', innerFormat: block.format, name: block.name };
    if (block.type === 'characterNote') {
        return {
            type: 'plain',
            type2: 'globalNote',
            text: block.format ?? '',
            role: keiRoleToRisu(block.role),
            name: block.name
        };
    }
    if (block.type === 'chatNote') {
        return { type: 'authornote', innerFormat: block.format, name: block.name };
    }
    if (block.type === 'history') {
        return {
            type: 'chat',
            rangeStart: block.start ?? -1000,
            rangeEnd: block.end ?? 'end',
            name: block.name
        };
    }
    return {
        type: 'plain',
        type2: 'normal',
        text: block.content,
        role: keiRoleToRisu(block.role),
        name: block.name
    };
}

function promptName(type: string, index: number): string {
    return `${type} ${index + 1}`;
}

function risuRoleToKei(role: RisuRole | undefined): LLMRole {
    if (role === 'bot') return 'assistant';
    if (role === 'user') return 'user';
    return 'system';
}

function keiRoleToRisu(role: LLMRole): RisuRole {
    if (role === 'assistant') return 'bot';
    if (role === 'user') return 'user';
    return 'system';
}

function readPercent(value: unknown, fallback: number): number {
    return typeof value === 'number' ? value * 100 : fallback;
}

function readRisuPercent(value: unknown): number | undefined {
    if (typeof value !== 'number' || value === -1000) return undefined;
    return value / 100;
}

function readRisuDisabledNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' || value === -1000) return undefined;
    return value;
}

function optionalFormat(value: string | undefined): string | undefined {
    const normalized = normalizeCharacterMacros(value ?? '');
    return normalized.trim() ? normalized : undefined;
}

async function encrypt(data: Uint8Array, keyText: string): Promise<ArrayBuffer> {
    const key = await cryptoKey(keyText);
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, data.slice());
}

async function decrypt(data: Uint8Array, keyText: string): Promise<ArrayBuffer> {
    const key = await cryptoKey(keyText);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, data.slice());
}

async function cryptoKey(value: string): Promise<CryptoKey> {
    const hash = await crypto.subtle.digest('SHA-256', TEXT_ENCODER.encode(value));
    return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function isKeiPresetPackage(value: unknown): value is KeiPresetPackageV1 {
    return isRecord(value) && value.version === 1 && value.kind === 'keiai.preset';
}
