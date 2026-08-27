import { textEncoder } from '$lib/crypto';
import { decompressSync } from 'fflate';
import { decode } from 'msgpackr';
import type { LLMRole } from '$lib/types/models/llm';
import { AppError } from '$lib/types/errors';
import type { RisuRegexScript } from '../risu/script';
import { decodeRPack } from '../risu/rpack';
import { risuScriptToKei } from '../risu/script';
import { normalizeRisuTemplate } from '../risu/template';
import type { KeiPresetPackageV1 } from './types';
import { isRecord, readDefaultVariables, refs, sortOrder } from '../utils';
import { createDefaultChatWorkflow } from '$lib/workflow/defaults';
import type { PromptBlockFields } from '$lib/workflow/types';
import { readRisuTogglePanel } from '../risu/toggle';

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
    const toggles = readRisuTogglePanel(risu.customPromptTemplateToggle ?? '');
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
            models: {
                chat: {
                    id: risu.aiModel ?? 'openai::gpt-5.6',
                    provider: 'openai'
                },
                aux: {
                    id: risu.subModel ?? risu.aiModel ?? 'openai::gpt-5.6',
                    provider: 'openai'
                }
            },
            parameters: {
                chat: {
                    ...(temperature != null ? { temperature } : {}),
                    ...(frequencyPenalty != null ? { frequency_penalty: frequencyPenalty } : {}),
                    ...(presencePenalty != null ? { presence_penalty: presencePenalty } : {}),
                    ...(topP != null ? { top_p: topP } : {})
                }
            },
            chatWorkflow: createDefaultChatWorkflow({
                promptBlocks,
                maxResponse: readRisuDisabledNumber(risu.maxResponse) ?? 300,
                maxContext: readRisuDisabledNumber(risu.maxContext) ?? 4000,
                lorebookRatio: 0.2,
                memoryRatio: 0.2,
                lorebookScanDepth: 5
            }),
            commands: { refs: {}, folders: {} },
            defaultVariables: readDefaultVariables(risu.templateDefaultVariables),
            toggles,
            scripts: refs(scripts)
        }
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

function risuPromptToKeiBlock(
    item: RisuPromptItem,
    index: number,
    hasPostEverything: boolean
): PromptBlockFields | null {
    const name = item.name ?? promptName(item.type, index);
    if (item.type === 'description')
        return {
            name,
            type: 'message',
            role: 'system',
            content: formatMacroText(item.innerFormat, '{{description}}')
        };
    if (item.type === 'persona')
        return {
            name,
            type: 'message',
            role: 'system',
            content: formatMacroText(item.innerFormat, '{{persona}}')
        };
    if (item.type === 'plain' && item.type2 === 'globalNote')
        return {
            name,
            type: 'message',
            role: 'system',
            content: formatMacroText(item.text, '{{characternote}}')
        };
    if (item.type === 'lorebook') {
        return {
            name,
            type: 'lorebook',
            ...(hasPostEverything ? { minDepth: 1 } : {})
        };
    }
    if (item.type === 'postEverything') {
        return { name, type: 'lorebook', maxDepth: 0 };
    }
    if (item.type === 'memory') {
        const format = normalizeOptionalTemplate(item.innerFormat);
        return {
            name,
            type: 'memory',
            algorithmId: 'mock',
            importance: 1,
            role: 'system',
            ...(format ? { format } : {})
        };
    }
    if (item.type === 'authornote')
        return {
            name,
            type: 'message',
            role: 'system',
            content: formatMacroText(item.innerFormat ?? item.defaultText, '{{chatnote}}')
        };
    if (item.type === 'chatML' || item.type === 'cache') return null;
    if (item.type === 'chat') {
        return {
            name,
            type: 'history',
            historyMode: 'full_trace',
            ...(item.rangeStart === -1000 ? {} : { start: String(item.rangeStart) }),
            ...(item.rangeEnd === 'end' ? {} : { end: String(item.rangeEnd) })
        };
    }
    return {
        name,
        type: 'message',
        role: risuRoleToKei('role' in item ? item.role : undefined),
        content: 'text' in item ? normalizeRisuTemplate(item.text ?? '') : ''
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

function readRisuPercent(value: unknown): number | undefined {
    if (typeof value !== 'number' || value === -1000) return undefined;
    return value / 100;
}

function readRisuDisabledNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' || value === -1000) return undefined;
    return value;
}

function normalizeOptionalTemplate(value: string | undefined): string | undefined {
    const normalized = normalizeRisuTemplate(value ?? '');
    return normalized.trim() ? normalized : undefined;
}

function formatMacroText(format: string | undefined, fallbackMacro: string): string {
    const normalized = normalizeOptionalTemplate(format);
    if (!normalized) return fallbackMacro;
    return normalized.replaceAll('{{slot}}', fallbackMacro);
}

async function decrypt(data: Uint8Array, keyText: string): Promise<ArrayBuffer> {
    const key = await cryptoKey(keyText);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, data.slice());
}

async function cryptoKey(value: string): Promise<CryptoKey> {
    const hash = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
    return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function isKeiPresetPackage(value: unknown): value is KeiPresetPackageV1 {
    return isRecord(value) && value.version === 1 && value.kind === 'keiai.preset';
}
