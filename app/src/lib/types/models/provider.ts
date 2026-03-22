import type { BuiltInLLMProvider } from './llm';
import type { BuiltInTTSProvider } from './tts';
import type { BuiltInEmbeddingProvider } from './embedding';

export type ApiProvider = BuiltInLLMProvider | BuiltInTTSProvider | BuiltInEmbeddingProvider;
