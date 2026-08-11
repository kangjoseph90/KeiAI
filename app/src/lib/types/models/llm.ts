/**
 * Model & Tokenizer Definitions — KeiAI
 *
 * Shared vocabulary for model metadata, tokenizer types, and API handlers.
 * Referenced by adapters (tokenizer), llm (provider/prompt), and UI (model selector).
 */

// ─── Types ───────────────────────────────────────────────────────────────
export type BuiltInLLMType = 'chat' | 'aux';
export type LLMType = BuiltInLLMType | string;

export interface LLMTypeDefinition {
    type: LLMType;
    agentNames?: string[];
    description?: string;
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

/** Supported tokenizer encodings. Each maps to a concrete tokenizer implementation. */
export type LLMTokenizer =
    | 'o200k_base' // OpenAI (GPT-4o, o1, o3)
    | 'claude' // Anthropic (Claude 3.5/4)
    | 'llama3' // Meta (Llama 3/4) + most open-source derivatives
    | 'deepseek' // DeepSeek (V3, R1)
    | 'gemma' // Google (Gemini 1.5/2.0/2.5)
    | 'mistral'; // Mistral (Large, Codestral)

// ─── API Handler ─────────────────────────────────────────────────────────────

export type LLMHandler =
    | 'openai_compatible' // OpenAI Completions API
    | 'anthropic'
    | 'google';

/** Canonical roles for LLM messages */
export type LLMRole = 'system' | 'user' | 'assistant';

// ─── Built-in Provider Types ─────────────────────────────────────────────────────────

export type BuiltInLLMProvider =
    | 'openai'
    | 'anthropic'
    | 'deepseek'
    | 'google'
    | 'mistral'
    | 'openrouter'
    | 'mock';

export type TransformersLLMProvider = 'transformers';
export type CustomLLMProvider = 'custom';
export type PluginLLMProvider = 'plugin';
export type LLMProvider =
    | BuiltInLLMProvider
    | TransformersLLMProvider
    | CustomLLMProvider
    | PluginLLMProvider;

export type TransformersLLMRuntime =
    | { kind: 'pipeline'; task: 'text-generation' }
    | { kind: 'gemma4' }
    | { kind: 'qwen35' };

// Parameter

export type LLMParameter =
    | 'temperature'
    | 'top_k'
    | 'min_p'
    | 'top_a'
    | 'top_p'
    | 'repetition_penalty'
    | 'frequency_penalty'
    | 'presence_penalty'
    | 'reasoning_effort'
    | 'thinking_tokens'
    | 'verbosity';

export type LLMParameters = Partial<Record<LLMParameter, number | string | boolean>>;

export type LLMCapability =
    | 'image_input'
    | 'audio_input'
    | 'video_input'
    | 'streaming'
    | 'tool_call';
export type LLMCapabilities = LLMCapability[];

// Display names for UI

const tokenizerNames: Record<LLMTokenizer, string> = {
    o200k_base: 'OpenAI 200K',
    claude: 'Claude',
    llama3: 'LLaMA 3',
    deepseek: 'DeepSeek',
    gemma: 'Gemma',
    mistral: 'Mistral'
};

const handlerNames: Record<LLMHandler, string> = {
    openai_compatible: 'OpenAI Compatible',
    anthropic: 'Anthropic Claude',
    google: 'Google Cloud'
};

const providerNames: Record<LLMProvider, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    deepseek: 'DeepSeek',
    google: 'Google',
    mistral: 'Mistral',
    openrouter: 'OpenRouter',
    transformers: 'Transformers',
    mock: 'Mock',
    custom: 'Custom',
    plugin: 'Plugin'
};
// Display names for UI

const parameterNames: Record<LLMParameter, string> = {
    temperature: 'Temperature',
    top_k: 'Top-K',
    min_p: 'Min-P',
    top_a: 'Top-A',
    top_p: 'Top-P',
    repetition_penalty: 'Repetition Penalty',
    frequency_penalty: 'Frequency Penalty',
    presence_penalty: 'Presence Penalty',
    reasoning_effort: 'Reasoning Effort',
    thinking_tokens: 'Thinking Tokens',
    verbosity: 'Verbosity'
};

const capabilityNames: Record<LLMCapability, string> = {
    image_input: 'Image input',
    audio_input: 'Audio input',
    video_input: 'Video input',
    streaming: 'Streaming',
    tool_call: 'Tool calling'
};

export function getLLMTokenizerName(encoding: LLMTokenizer): string {
    return tokenizerNames[encoding] || encoding;
}

export function getLLMHandlerName(handler: LLMHandler): string {
    return handlerNames[handler] || handler;
}

export function getLLMProviderName(provider: LLMProvider): string {
    return providerNames[provider] || provider;
}

export function getLLMParameterName(param: LLMParameter): string {
    return parameterNames[param] || param;
}

export function getLLMCapabilityName(capability: LLMCapability): string {
    return capabilityNames[capability] || capability;
}

export interface LLMModelBase {
    id: string;
    name: string;
    modelId: string; // The ID used by the provider API (e.g. "gpt-4o", "claude-2")
    tokenizer: LLMTokenizer;
    unsupported?: LLMCapabilities;
}

export interface BuiltInLLMModel extends LLMModelBase {
    provider: BuiltInLLMProvider;
}

export interface TransformersLLMModel extends LLMModelBase {
    provider: 'transformers';
    runtime: TransformersLLMRuntime;
}

export interface CustomLLMModel extends LLMModelBase {
    provider: CustomLLMProvider;
    handler: LLMHandler;
    baseUrl: string;
    apiKey?: string;
}

export interface PluginLLMModel extends LLMModelBase {
    provider: PluginLLMProvider;
}

export type LLMModel = BuiltInLLMModel | TransformersLLMModel | CustomLLMModel | PluginLLMModel;

export interface LLMModelConfig {
    id: string;
    provider: LLMProvider;
    tokenizer?: LLMTokenizer;
}

const OPENAI_MODELS: BuiltInLLMModel[] = [
    {
        id: 'openai::gpt-5.6',
        name: 'GPT 5.6',
        modelId: 'gpt-5.6',
        provider: 'openai',
        tokenizer: 'o200k_base',
        unsupported: ['video_input']
    },
    {
        id: 'openai::gpt-5.6-sol',
        name: 'GPT 5.6 Sol',
        modelId: 'gpt-5.6-sol',
        provider: 'openai',
        tokenizer: 'o200k_base',
        unsupported: ['video_input']
    },
    {
        id: 'openai::gpt-5.6-terra',
        name: 'GPT 5.6 Terra',
        modelId: 'gpt-5.6-terra',
        provider: 'openai',
        tokenizer: 'o200k_base',
        unsupported: ['video_input']
    },
    {
        id: 'openai::gpt-5.6-luna',
        name: 'GPT 5.6 Luna',
        modelId: 'gpt-5.6-luna',
        provider: 'openai',
        tokenizer: 'o200k_base',
        unsupported: ['video_input']
    },
    {
        id: 'openai::gpt-5.5',
        name: 'GPT 5.5',
        modelId: 'gpt-5.5',
        provider: 'openai',
        tokenizer: 'o200k_base',
        unsupported: ['video_input']
    },
    {
        id: 'openai::gpt-5.4',
        name: 'GPT 5.4',
        modelId: 'gpt-5.4',
        provider: 'openai',
        tokenizer: 'o200k_base',
        unsupported: ['video_input']
    },
    {
        id: 'openai::gpt-5.3',
        name: 'GPT 5.3',
        modelId: 'gpt-5.3',
        provider: 'openai',
        tokenizer: 'o200k_base',
        unsupported: ['video_input']
    },
    {
        id: 'openai::gpt-5.2',
        name: 'GPT 5.2',
        modelId: 'gpt-5.2',
        provider: 'openai',
        tokenizer: 'o200k_base',
        unsupported: ['video_input']
    },
    {
        id: 'openai::gpt-5.1',
        name: 'GPT 5.1',
        modelId: 'gpt-5.1',
        provider: 'openai',
        tokenizer: 'o200k_base',
        unsupported: ['video_input']
    },
    {
        id: 'openai::gpt-5',
        name: 'GPT 5',
        modelId: 'gpt-5',
        provider: 'openai',
        tokenizer: 'o200k_base',
        unsupported: ['video_input']
    },
    {
        id: 'openai::gpt-5-mini',
        name: 'GPT 5 mini',
        modelId: 'gpt-5-mini',
        provider: 'openai',
        tokenizer: 'o200k_base',
        unsupported: ['video_input']
    },
    {
        id: 'openai::gpt-5-nano',
        name: 'GPT 5 nano',
        modelId: 'gpt-5-nano',
        provider: 'openai',
        tokenizer: 'o200k_base',
        unsupported: ['video_input']
    }
];

const ANTHROPIC_MODELS: BuiltInLLMModel[] = [
    {
        id: 'anthropic::claude-fable-5',
        name: 'Claude Fable 5',
        modelId: 'claude-fable-5',
        provider: 'anthropic',
        tokenizer: 'claude',
        unsupported: ['audio_input', 'video_input']
    },
    {
        id: 'anthropic::claude-opus-5',
        name: 'Claude Opus 5',
        modelId: 'claude-opus-5',
        provider: 'anthropic',
        tokenizer: 'claude',
        unsupported: ['audio_input', 'video_input']
    },
    {
        id: 'anthropic::claude-sonnet-5',
        name: 'Claude Sonnet 5',
        modelId: 'claude-sonnet-5',
        provider: 'anthropic',
        tokenizer: 'claude',
        unsupported: ['audio_input', 'video_input']
    },
    {
        id: 'anthropic::claude-opus-4-8',
        name: 'Claude Opus 4.8',
        modelId: 'claude-opus-4-8',
        provider: 'anthropic',
        tokenizer: 'claude',
        unsupported: ['audio_input', 'video_input']
    },
    {
        id: 'anthropic::claude-opus-4-7',
        name: 'Claude Opus 4.7',
        modelId: 'claude-opus-4-7',
        provider: 'anthropic',
        tokenizer: 'claude',
        unsupported: ['audio_input', 'video_input']
    },
    {
        id: 'anthropic::claude-opus-4-6',
        name: 'Claude Opus 4.6',
        modelId: 'claude-opus-4-6',
        provider: 'anthropic',
        tokenizer: 'claude',
        unsupported: ['audio_input', 'video_input']
    },
    {
        id: 'anthropic::claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        modelId: 'claude-sonnet-4-6',
        provider: 'anthropic',
        tokenizer: 'claude',
        unsupported: ['audio_input', 'video_input']
    },
    {
        id: 'anthropic::claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        modelId: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        tokenizer: 'claude',
        unsupported: ['audio_input', 'video_input']
    },
    {
        id: 'anthropic::claude-haiku-4-5',
        name: 'Claude Haiku 4.5',
        modelId: 'claude-haiku-4-5-20251001',
        provider: 'anthropic',
        tokenizer: 'claude',
        unsupported: ['audio_input', 'video_input']
    },
    {
        id: 'anthropic::claude-opus-4-5',
        name: 'Claude Opus 4.5',
        modelId: 'claude-opus-4-5-20251101',
        provider: 'anthropic',
        tokenizer: 'claude',
        unsupported: ['audio_input', 'video_input']
    }
];

const DEEPSEEK_MODELS: BuiltInLLMModel[] = [
    {
        id: 'deepseek::deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        modelId: 'deepseek-v4-pro',
        provider: 'deepseek',
        tokenizer: 'deepseek',
        unsupported: ['image_input', 'audio_input', 'video_input']
    },
    {
        id: 'deepseek::deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        modelId: 'deepseek-v4-flash',
        provider: 'deepseek',
        tokenizer: 'deepseek',
        unsupported: ['image_input', 'audio_input', 'video_input']
    }
];

const GOOGLE_MODELS: BuiltInLLMModel[] = [
    {
        id: 'google::gemini-3.6-flash',
        name: 'Gemini 3.6 Flash',
        modelId: 'gemini-3.6-flash',
        provider: 'google',
        tokenizer: 'gemma'
    },
    {
        id: 'google::gemini-3.5-flash',
        name: 'Gemini 3.5 Flash',
        modelId: 'gemini-3.5-flash',
        provider: 'google',
        tokenizer: 'gemma'
    },
    {
        id: 'google::gemini-3.5-flash-lite',
        name: 'Gemini 3.5 Flash-Lite',
        modelId: 'gemini-3.5-flash-lite',
        provider: 'google',
        tokenizer: 'gemma'
    },
    {
        id: 'google::gemini-3.1-flash-lite',
        name: 'Gemini 3.1 Flash-Lite',
        modelId: 'gemini-3.1-flash-lite',
        provider: 'google',
        tokenizer: 'gemma'
    },
    {
        id: 'google::gemini-3.1-pro-preview',
        name: 'Gemini 3.1 Pro (preview)',
        modelId: 'gemini-3.1-pro-preview',
        provider: 'google',
        tokenizer: 'gemma'
    },
    {
        id: 'google::gemini-3-flash-preview',
        name: 'Gemini 3 Flash (preview)',
        modelId: 'gemini-3-flash-preview',
        provider: 'google',
        tokenizer: 'gemma'
    },
    {
        id: 'google::gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        modelId: 'gemini-2.5-pro',
        provider: 'google',
        tokenizer: 'gemma'
    },
    {
        id: 'google::gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        modelId: 'gemini-2.5-flash',
        provider: 'google',
        tokenizer: 'gemma'
    },
    {
        id: 'google::gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash-Lite',
        modelId: 'gemini-2.5-flash-lite',
        provider: 'google',
        tokenizer: 'gemma'
    }
];

const MISTRAL_MODELS: BuiltInLLMModel[] = [
    {
        id: 'mistral::mistral-medium-3-5',
        name: 'Mistral Medium 3.5',
        modelId: 'mistral-medium-3-5',
        provider: 'mistral',
        tokenizer: 'mistral',
        unsupported: ['audio_input', 'video_input']
    },
    {
        id: 'mistral::mistral-small-2603',
        name: 'Mistral Small 4',
        modelId: 'mistral-small-2603',
        provider: 'mistral',
        tokenizer: 'mistral',
        unsupported: ['audio_input', 'video_input']
    },
    {
        id: 'mistral::mistral-large-2512',
        name: 'Mistral Large 3',
        modelId: 'mistral-large-2512',
        provider: 'mistral',
        tokenizer: 'mistral',
        unsupported: ['audio_input', 'video_input']
    }
];

export const TRANSFORMERS_LLM_MODELS: TransformersLLMModel[] = [
    {
        id: 'transformers::onnx-community/LFM2.5-350M-ONNX',
        name: 'LFM2.5 350M',
        modelId: 'onnx-community/LFM2.5-350M-ONNX',
        provider: 'transformers',
        runtime: { kind: 'pipeline', task: 'text-generation' },
        tokenizer: 'o200k_base',
        unsupported: ['image_input', 'audio_input', 'video_input', 'tool_call']
    },
    {
        id: 'transformers::onnx-community/LFM2-2.6B-ONNX',
        name: 'LFM2 2.6B',
        modelId: 'onnx-community/LFM2-2.6B-ONNX',
        provider: 'transformers',
        runtime: { kind: 'pipeline', task: 'text-generation' },
        tokenizer: 'o200k_base',
        unsupported: ['image_input', 'audio_input', 'video_input', 'tool_call']
    },
    {
        id: 'transformers::onnx-community/gemma-4-E2B-it-ONNX',
        name: 'Gemma 4 E2B',
        modelId: 'onnx-community/gemma-4-E2B-it-ONNX',
        provider: 'transformers',
        runtime: { kind: 'gemma4' },
        tokenizer: 'gemma',
        unsupported: ['video_input', 'tool_call']
    },
    {
        id: 'transformers::onnx-community/gemma-4-E4B-it-ONNX',
        name: 'Gemma 4 E4B',
        modelId: 'onnx-community/gemma-4-E4B-it-ONNX',
        provider: 'transformers',
        runtime: { kind: 'gemma4' },
        tokenizer: 'gemma',
        unsupported: ['video_input', 'tool_call']
    },
    {
        id: 'transformers::onnx-community/Qwen3.5-0.8B-ONNX-OPT',
        name: 'Qwen 3.5 0.8B',
        modelId: 'onnx-community/Qwen3.5-0.8B-ONNX-OPT',
        provider: 'transformers',
        runtime: { kind: 'qwen35' },
        tokenizer: 'o200k_base',
        unsupported: ['audio_input', 'video_input', 'tool_call']
    },
    {
        id: 'transformers::onnx-community/Qwen3.5-2B-ONNX-OPT',
        name: 'Qwen 3.5 2B',
        modelId: 'onnx-community/Qwen3.5-2B-ONNX-OPT',
        provider: 'transformers',
        runtime: { kind: 'qwen35' },
        tokenizer: 'o200k_base',
        unsupported: ['audio_input', 'video_input', 'tool_call']
    }
];

const MOCK_MODELS: BuiltInLLMModel[] = [
    {
        id: 'mock::default',
        name: 'Default',
        modelId: 'default',
        provider: 'mock',
        tokenizer: 'o200k_base'
    },
    {
        id: 'mock::echo',
        name: 'Echo',
        modelId: 'echo',
        provider: 'mock',
        tokenizer: 'o200k_base'
    },
    {
        id: 'mock::markdown',
        name: 'Markdown',
        modelId: 'markdown',
        provider: 'mock',
        tokenizer: 'o200k_base'
    }
];

export const BUILT_IN_LLM_MODELS: BuiltInLLMModel[] = [
    ...OPENAI_MODELS,
    ...ANTHROPIC_MODELS,
    ...DEEPSEEK_MODELS,
    ...GOOGLE_MODELS,
    ...MISTRAL_MODELS,
    ...MOCK_MODELS
];

export function getBuiltInLLMModels(provider: BuiltInLLMProvider): readonly BuiltInLLMModel[] {
    return BUILT_IN_LLM_MODELS.filter((model) => model.provider === provider);
}
