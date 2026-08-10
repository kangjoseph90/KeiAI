import { appHttp } from '$lib/adapters/http';
import { AppError } from '$lib/types/errors';
import { buildUrl } from '$lib/utils/url';

export type OpenRouterModelCapability = 'llm' | 'image' | 'tts' | 'stt' | 'embedding' | 'reranker';

export interface OpenRouterModelOption {
    id: string;
    name: string;
    inputModalities: string[];
    outputModalities: string[];
    supportedParameters: string[];
}

export interface OpenRouterModelDiscoveryConfig {
    apiKey?: string;
    baseUrl?: string;
    useProxy?: boolean;
}

interface OpenRouterModelResponse {
    data?: unknown[];
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const modelCache = new Map<string, Promise<OpenRouterModelOption[]>>();

export function listOpenRouterModels(
    capability: OpenRouterModelCapability,
    config: OpenRouterModelDiscoveryConfig,
    signal?: AbortSignal
): Promise<OpenRouterModelOption[]> {
    if (signal) return fetchOpenRouterModels(capability, config, signal);

    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const cacheKey = `${baseUrl}:${capability}:${config.apiKey ?? ''}`;
    const cached = modelCache.get(cacheKey);
    if (cached) return cached;

    const request = fetchOpenRouterModels(capability, config).catch((error: unknown) => {
        modelCache.delete(cacheKey);
        throw error;
    });
    modelCache.set(cacheKey, request);
    return request;
}

async function fetchOpenRouterModels(
    capability: OpenRouterModelCapability,
    config: OpenRouterModelDiscoveryConfig,
    signal?: AbortSignal
): Promise<OpenRouterModelOption[]> {
    const headers: Record<string, string> = {};
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    const response = await appHttp.fetch(
        buildUrl(config.baseUrl ?? DEFAULT_BASE_URL, discoveryPath(capability)),
        { method: 'GET', headers, signal },
        { proxy: config.useProxy ?? true, signal }
    );

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new AppError(
            'NETWORK_ERROR',
            `OpenRouter ${capability} model discovery failed (${response.status})${body ? `: ${body}` : ''}`
        );
    }

    const payload = (await response.json()) as OpenRouterModelResponse;
    if (!Array.isArray(payload.data)) {
        throw new AppError(
            'NETWORK_ERROR',
            `OpenRouter returned an invalid ${capability} model catalog`
        );
    }

    const models = payload.data
        .map(parseModel)
        .filter((model): model is OpenRouterModelOption => model !== null);
    if (models.length === 0) {
        throw new AppError('NOT_FOUND', `OpenRouter returned no ${capability} models`);
    }
    return models;
}

function discoveryPath(capability: OpenRouterModelCapability): string {
    switch (capability) {
        case 'image':
            return '/images/models';
        case 'tts':
            return '/models?output_modalities=speech';
        case 'stt':
            return '/models?output_modalities=transcription';
        case 'embedding':
            return '/models?output_modalities=embeddings';
        case 'reranker':
            return '/models?output_modalities=rerank';
        case 'llm':
            return '/models?output_modalities=text';
    }
}

function parseModel(value: unknown): OpenRouterModelOption | null {
    if (!isRecord(value) || typeof value.id !== 'string') return null;

    const architecture = isRecord(value.architecture) ? value.architecture : {};
    return {
        id: value.id,
        name: typeof value.name === 'string' ? value.name : value.id,
        inputModalities: stringArray(architecture.input_modalities),
        outputModalities: stringArray(architecture.output_modalities),
        supportedParameters: supportedParameterNames(value.supported_parameters)
    };
}

function supportedParameterNames(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === 'string');
    }
    return isRecord(value) ? Object.keys(value) : [];
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
