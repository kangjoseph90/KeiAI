/**
 * Model & Tokenizer Definitions — KeiAI
 *
 * Shared vocabulary for model metadata, tokenizer types, and API handlers.
 * Referenced by adapters (tokenizer), llm (provider/prompt), and UI (model selector).
 */

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
export type LLMProvider = BuiltInLLMProvider | CustomLLMProvider;

// model capability flags

export type LLMFlags = 'streaming' | 'imageInput';

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
	custom: 'Custom'
};

const flagNames: Record<LLMFlags, string> = {
	streaming: 'Streaming',
	imageInput: 'Image Input'
};

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

export function getLLMTokenizerName(encoding: LLMTokenizer): string {
	return tokenizerNames[encoding] || encoding;
}

export function getLLMHandlerName(handler: LLMHandler): string {
	return handlerNames[handler] || handler;
}

export function getLLMProviderName(provider: LLMProvider): string {
	return providerNames[provider] || provider;
}

export function getLLMFlagName(flag: LLMFlags): string {
	return flagNames[flag] || flag;
}

export function getLLMParameterName(param: LLMParameter): string {
	return parameterNames[param] || param;
}

export interface LLMModelBase {
	id: string;
	name: string;
	modelId: string; // The ID used by the provider API (e.g. "gpt-4o", "claude-2")
	flags: LLMFlags[];
	tokenizer: LLMTokenizer;
}

export interface BuiltInLLMModel extends LLMModelBase {
	provider: BuiltInLLMProvider;
	parameters: LLMParameter[];
}

export interface CustomLLMModel extends LLMModelBase {
	provider: CustomLLMProvider;
	handler: LLMHandler;
	baseUrl: string;
	apiKey?: string;
}

export type LLMModel = BuiltInLLMModel | CustomLLMModel;

export interface LLMModelConfig {
	id: string;
	provider: LLMProvider;
	tokenizer?: LLMTokenizer;
	parameters: Partial<Record<LLMParameter, number | string | boolean>>;
}

const OPENAI_MODELS: BuiltInLLMModel[] = [
	{
		id: 'openai::gpt-5.4',
		name: 'GPT-5.4',
		modelId: 'gpt-5.4',
		provider: 'openai',
		tokenizer: 'o200k_base',
		flags: ['streaming'],
		parameters: ['temperature']
	}
];

const ANTHROPIC_MODELS: BuiltInLLMModel[] = [
	{
		id: 'anthropic::claude-4-6-sonnet',
		name: 'Claude 4.6 Sonnet',
		modelId: 'claude-4-6-sonnet',
		provider: 'anthropic',
		tokenizer: 'claude',
		flags: ['streaming'],
		parameters: ['temperature']
	}
];

const DEEPSEEK_MODELS: BuiltInLLMModel[] = [
	{
		id: 'deepseek::deepseek-chat',
		name: 'DeepSeek Chat',
		modelId: 'deepseek-chat',
		provider: 'deepseek',
		tokenizer: 'deepseek',
		flags: ['streaming'],
		parameters: ['temperature']
	}
];

const GOOGLE_MODELS: BuiltInLLMModel[] = [
	{
		id: 'google::gemini-3.1-pro',
		name: 'Gemini 3.1 Pro',
		modelId: 'gemini-3.1-pro',
		provider: 'google',
		tokenizer: 'gemma',
		flags: ['streaming'],
		parameters: ['temperature']
	}
];

const MISTRAL_MODELS: BuiltInLLMModel[] = [
	{
		id: 'mistral::mistral-large-2512',
		name: 'Mistral Large 3',
		modelId: 'mistral-large-2512',
		provider: 'mistral',
		tokenizer: 'mistral',
		flags: ['streaming'],
		parameters: ['temperature']
	}
];

const MOCK_MODELS: BuiltInLLMModel[] = [
	{
		id: 'mock::default',
		name: 'Default',
		modelId: 'default',
		provider: 'mock',
		tokenizer: 'o200k_base',
		flags: ['streaming'],
		parameters: []
	},
	{
		id: 'mock::echo',
		name: 'Echo',
		modelId: 'echo',
		provider: 'mock',
		tokenizer: 'o200k_base',
		flags: ['streaming'],
		parameters: []
	},
	{
		id: 'mock::markdown',
		name: 'Markdown',
		modelId: 'markdown',
		provider: 'mock',
		tokenizer: 'o200k_base',
		flags: ['streaming'],
		parameters: []
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
