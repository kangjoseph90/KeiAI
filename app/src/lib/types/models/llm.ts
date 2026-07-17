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
    | 'transformers'
    | 'mock';

export type CustomLLMProvider = 'custom';
export type PluginLLMProvider = 'plugin';
export type LLMProvider = BuiltInLLMProvider | CustomLLMProvider | PluginLLMProvider;

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

export type LLMCapability = 'image_input' | 'streaming';
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
    streaming: 'Streaming'
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

export interface CustomLLMModel extends LLMModelBase {
    provider: CustomLLMProvider;
    handler: LLMHandler;
    baseUrl: string;
    apiKey?: string;
}

export interface PluginLLMModel extends LLMModelBase {
    provider: PluginLLMProvider;
}

export type LLMModel = BuiltInLLMModel | CustomLLMModel | PluginLLMModel;

export interface LLMModelConfig {
    id: string;
    provider: LLMProvider;
    tokenizer?: LLMTokenizer;
}

const OPENAI_MODELS: BuiltInLLMModel[] = [
    {
        id: 'openai::gpt-5.5',
        name: 'GPT 5.5',
        modelId: 'gpt-5.5',
        provider: 'openai',
        tokenizer: 'o200k_base'
    },
    {
        id: 'openai::gpt-5.4',
        name: 'GPT 5.4',
        modelId: 'gpt-5.4',
        provider: 'openai',
        tokenizer: 'o200k_base'
    }
];

const ANTHROPIC_MODELS: BuiltInLLMModel[] = [
    {
        id: 'anthropic::claude-4.7-opus',
        name: 'Claude 4.7 Opus',
        modelId: 'claude-4.7-opus',
        provider: 'anthropic',
        tokenizer: 'claude'
    },
    {
        id: 'anthropic::claude-4-6-sonnet',
        name: 'Claude 4.6 Sonnet',
        modelId: 'claude-4-6-sonnet',
        provider: 'anthropic',
        tokenizer: 'claude'
    }
];

const DEEPSEEK_MODELS: BuiltInLLMModel[] = [
    {
        id: 'deepseek::deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        modelId: 'deepseek-v4-pro',
        provider: 'deepseek',
        tokenizer: 'deepseek'
    },
    {
        id: 'deepseek::deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        modelId: 'deepseek-v4-flash',
        provider: 'deepseek',
        tokenizer: 'deepseek'
    }
];

const GOOGLE_MODELS: BuiltInLLMModel[] = [
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
        id: 'google::gemini-3.1-flash-lite',
        name: 'Gemini 3.1 Flash Lite',
        modelId: 'gemini-3.1-flash-lite',
        provider: 'google',
        tokenizer: 'gemma'
    }
];

const MISTRAL_MODELS: BuiltInLLMModel[] = [
    {
        id: 'mistral::mistral-large-2512',
        name: 'Mistral Large 3',
        modelId: 'mistral-large-2512',
        provider: 'mistral',
        tokenizer: 'mistral'
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
