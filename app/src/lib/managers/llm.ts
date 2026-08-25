import { selectLLMHandler } from '$lib/llm/handler';
import type {
    LLMContentPart,
    LLMMediaPart,
    LLMMessage,
    LLMStreamContent,
    LLMStreamOptions
} from '$lib/llm/types';
import { getPreset } from '$lib/stores/content/preset';
import { getAppSettings } from '$lib/stores/content/settings';
import { AppError } from '$lib/types/errors';
import type {
    LLMCapabilities,
    LLMCapability,
    LLMModelConfig,
    LLMParameters,
    LLMTokenizer,
    LLMType
} from '$lib/types/models/llm';
import { fromBase64 } from '$lib/crypto';
import { officeFileToTextPart } from '$lib/llm/attachments';

const DEFAULT_MAX_RESPONSE = 4096;

export interface LLMCallOptions extends Omit<LLMStreamOptions, 'parameters'> {
    presetId?: string;
}

export interface ResolvedLLM {
    tokenizer: LLMTokenizer;
    stream(
        messages: LLMMessage[],
        signal: AbortSignal,
        options?: Omit<LLMCallOptions, 'presetId'>
    ): AsyncIterable<LLMStreamContent>;
}

export async function resolveLLM(type: LLMType, presetId?: string): Promise<ResolvedLLM> {
    const settings = await getAppSettings();
    const resolvedPresetId = presetId ?? settings.presetId;
    if (!resolvedPresetId) {
        throw new AppError('INVALID_INPUT', 'No active preset selected');
    }

    const preset = await getPreset(resolvedPresetId);
    if (!preset) {
        throw new AppError('NOT_FOUND', `Preset not found: ${resolvedPresetId}`);
    }

    const modelConfig = resolveModelConfig(type, preset.models);
    if (!modelConfig) {
        throw new AppError('INVALID_INPUT', `No model configured for LLM type: ${type}`);
    }
    const selected = selectLLMHandler(modelConfig, settings);
    if (!selected) {
        throw new AppError('INVALID_INPUT', 'Failed to create LLM handler');
    }

    const parameters = resolveParameters(type, preset.parameters);
    const { handler, capabilities } = selected;
    return {
        tokenizer: modelConfig.tokenizer ?? 'o200k_base',
        stream: (messages, signal, options = {}) =>
            handler.stream(adaptMessages(messages, capabilities), signal, {
                parameters,
                maxResponse: options.maxResponse,
                stream: Boolean(options.stream) && capabilities.includes('streaming'),
                tools: capabilities.includes('tool_call') ? options.tools : undefined
            })
    };
}

export async function* streamLLM(
    type: LLMType,
    messages: LLMMessage[],
    signal: AbortSignal,
    options: LLMCallOptions = {}
): AsyncIterable<LLMStreamContent> {
    const resolved = await resolveLLM(type, options.presetId);
    yield* resolved.stream(messages, signal, {
        maxResponse: options.maxResponse ?? DEFAULT_MAX_RESPONSE,
        stream: options.stream ?? true,
        tools: options.tools
    });
}

export async function callLLM(
    type: LLMType,
    messages: LLMMessage[],
    signal: AbortSignal,
    options: LLMCallOptions = {}
): Promise<string> {
    let content = '';
    for await (const state of streamLLM(type, messages, signal, options)) {
        content = state.parts
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('');
    }
    return content;
}

function resolveModelConfig(
    type: LLMType,
    models: Partial<Record<LLMType, LLMModelConfig>>
): LLMModelConfig | null {
    const configured = models[type];
    if (configured) return configured;
    if (type === 'chat') return null;
    if (type === 'aux') return models.chat ?? null;
    return models.aux ?? models.chat ?? null;
}

function resolveParameters(
    type: LLMType,
    parameters: Partial<Record<LLMType, LLMParameters>>
): LLMParameters {
    const configured = parameters[type];
    if (configured) return configured;
    if (type === 'chat') return {};
    return parameters.chat ?? {};
}

const mediaCapabilities: Record<LLMMediaPart['type'], LLMCapability> = {
    image: 'image_input',
    audio: 'audio_input',
    video: 'video_input'
};

function adaptMessages(messages: LLMMessage[], capabilities: LLMCapabilities): LLMMessage[] {
    return messages
        .map((message) => ({
            ...message,
            content: message.content
                .map((part): LLMContentPart | null => adaptPart(part, capabilities))
                .filter((part): part is LLMContentPart => part !== null)
        }))
        .filter((message) => message.content.length > 0);
}

function adaptPart(part: LLMContentPart, capabilities: LLMCapabilities): LLMContentPart | null {
    if (
        !capabilities.includes('tool_call') &&
        (part.type === 'tool_request' || part.type === 'tool_response')
    ) {
        return null;
    }
    if (part.type !== 'image' && part.type !== 'audio' && part.type !== 'video') {
        if (part.type === 'file' && !capabilities.includes('file_input')) {
            const fallback = officeFileToTextPart(part.name, part.mimeType, fromBase64(part.data));
            if (fallback) return fallback;
            throw new AppError(
                'INVALID_INPUT',
                `The selected model does not support file attachments: ${part.name}`
            );
        }
        return part;
    }
    if (capabilities.includes(mediaCapabilities[part.type])) {
        return part;
    }
    return {
        type: 'text',
        text: `[${capitalize(part.type)} omitted: unsupported by model]`
    };
}

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}
