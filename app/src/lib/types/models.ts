/**
 * Model & Tokenizer Definitions — KeiAI
 *
 * Shared vocabulary for model metadata, tokenizer types, and API formats.
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

// ─── API Format ─────────────────────────────────────────────────────────────

export type LLMFormat =
	| 'openai_compatible' // OpenAI Completions API
	| 'anthropic'
	| 'google';

// ─── Built-in Provider Types ─────────────────────────────────────────────────────────

export type BuiltInProvider = 'openai' | 'anthropic' | 'deepseek' | 'google' | 'mistral';
export type CustomProvider = 'custom';
export type LLMProvider = BuiltInProvider | CustomProvider;

// model capability flags

export type LLMFlags = 'streaming' | 'imageInput';

// Parameter

export type Parameter =
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

const formatNames: Record<LLMFormat, string> = {
	openai_compatible: 'OpenAI Compatible',
	anthropic: 'Anthropic Claude',
	google: 'Google Cloud'
};

const builtInProviderUrls: Record<BuiltInProvider, string> = {
	openai: 'https://api.openai.com/v1',
	anthropic: 'https://api.anthropic.com/v1',
	deepseek: 'https://api.deepseek.com',
	google: 'https://generativelanguage.googleapis.com/v1beta',
	mistral: 'https://api.mistral.ai/v1'
};

const providerNames: Record<LLMProvider, string> = {
	openai: 'OpenAI',
	anthropic: 'Anthropic',
	deepseek: 'DeepSeek',
	google: 'Google',
	mistral: 'Mistral',
	custom: 'Custom'
};

const flagNames: Record<LLMFlags, string> = {
	streaming: 'Streaming',
	imageInput: 'Image Input'
};

const parameterNames: Record<Parameter, string> = {
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

export function getTokenizerName(encoding: LLMTokenizer): string {
	return tokenizerNames[encoding] || encoding;
}

export function getFormatName(format: LLMFormat): string {
	return formatNames[format] || format;
}

export function getProviderUrl(provider: BuiltInProvider): string {
	return builtInProviderUrls[provider] || provider;
}

export function getProviderName(provider: LLMProvider): string {
	return providerNames[provider] || provider;
}

export function getFlagName(flag: LLMFlags): string {
	return flagNames[flag] || flag;
}

export function getParameterName(param: Parameter): string {
	return parameterNames[param] || param;
}

export interface LLMModelBase {
	id: string;
	name: string;
	modelId: string; // The ID used by the provider API (e.g. "gpt-4o", "claude-2")
	format: LLMFormat;
	flags: LLMFlags[];
	tokenizer: LLMTokenizer;
}

export interface BuiltInModel extends LLMModelBase {
	provider: BuiltInProvider;
	parameters: Parameter[];
}

export interface CustomModel extends LLMModelBase {
	provider: CustomProvider;
	baseUrl: string;
	apiKey?: string;
}

export type LLMModel = BuiltInModel | CustomModel;

export interface ModelConfig {
	id: string;
	provider: LLMProvider;
	parameters: Partial<Record<Parameter, number | string | boolean>>;
}

const OPENAI_MODELS: BuiltInModel[] = [
	{
		id: 'openai::gpt-5.4',
		name: 'GPT-5.4',
		modelId: 'gpt-5.4',
		provider: 'openai',
		format: 'openai_compatible',
		tokenizer: 'o200k_base',
		flags: ['streaming'],
		parameters: ['temperature']
	}
];

const ANTHROPIC_MODELS: BuiltInModel[] = [
	{
		id: 'anthropic::claude-4-6-sonnet',
		name: 'Claude 4.6 Sonnet',
		modelId: 'claude-4-6-sonnet',
		provider: 'anthropic',
		format: 'anthropic',
		tokenizer: 'claude',
		flags: ['streaming'],
		parameters: ['temperature']
	}
];

const DEEPSEEK_MODELS: BuiltInModel[] = [
	{
		id: 'deepseek::deepseek-chat',
		name: 'DeepSeek Chat',
		modelId: 'deepseek-chat',
		provider: 'deepseek',
		format: 'openai_compatible',
		tokenizer: 'deepseek',
		flags: ['streaming'],
		parameters: ['temperature']
	}
];

const GOOGLE_MODELS: BuiltInModel[] = [
	{
		id: 'google::gemini-3.1-pro',
		name: 'Gemini 3.1 Pro',
		modelId: 'gemini-3.1-pro',
		provider: 'google',
		format: 'google',
		tokenizer: 'gemma',
		flags: ['streaming'],
		parameters: ['temperature']
	}
];

const MISTRAL_MODELS: BuiltInModel[] = [
	{
		id: 'mistral::mistral-large-2512',
		name: 'Mistral Large 3',
		modelId: 'mistral-large-2512',
		provider: 'mistral',
		format: 'openai_compatible',
		tokenizer: 'mistral',
		flags: ['streaming'],
		parameters: ['temperature']
	}
];

export const BUILT_IN_MODELS: BuiltInModel[] = [
	...OPENAI_MODELS,
	...ANTHROPIC_MODELS,
	...DEEPSEEK_MODELS,
	...GOOGLE_MODELS,
	...MISTRAL_MODELS
];
