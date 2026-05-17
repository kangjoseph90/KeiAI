import { compressSync, decompressSync } from 'fflate';
import { decode, encode } from 'msgpackr';
import type { LLMRole } from '$lib/types/models/llm';
import { AppError } from '$lib/types/errors';
import { decodeRPack, encodeRPack } from '../character/rpack';
import type { KeiPresetPackageV1 } from './types';

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
                    ...(risu.temperature != null ? { temperature: risu.temperature / 100 } : {}),
                    ...(risu.frequencyPenalty != null
                        ? { frequency_penalty: risu.frequencyPenalty / 100 }
                        : {}),
                    ...(risu.PresensePenalty != null
                        ? { presence_penalty: risu.PresensePenalty / 100 }
                        : {}),
                    ...(risu.top_p != null ? { top_p: risu.top_p } : {})
                }
            },
            auxModel: {
                id: risu.subModel ?? risu.aiModel ?? 'openai::gpt-5.4',
                provider: 'openai',
                parameters: {}
            },
            promptBlocks,
            maxResponse: risu.maxResponse ?? 300,
            maxContext: risu.maxContext ?? 4000,
            lorebookRatio: 0.2,
            memoryRatio: 0.2,
            lorebookScanDepth: 5,
            scripts: { refs: {}, folders: {} }
        },
        scripts: []
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
        promptTemplate: Object.values(pkg.preset.promptBlocks)
            .sort((a, b) => a.sortOrder.localeCompare(b.sortOrder))
            .filter((block) => block.enabled)
            .map(keiBlockToRisuPrompt),
        keiai: pkg
    };
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
            format: item.innerFormat
        };
    if (item.type === 'persona')
        return {
            name,
            type: 'persona' as const,
            role: 'system' as LLMRole,
            format: item.innerFormat
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
            format: item.innerFormat
        };
    if (item.type === 'authornote')
        return {
            name,
            type: 'chatNote' as const,
            role: 'system' as LLMRole,
            format: item.innerFormat
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
            format: item.text
        };
    }
    return {
        name,
        type: 'text' as const,
        role: risuRoleToKei('role' in item ? item.role : undefined),
        content: 'text' in item ? (item.text ?? '') : ''
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortOrder(index: number): string {
    return index.toString().padStart(6, '0');
}
