import type { RemoteLLMProvider } from './llm';
import type { RemoteTTSProvider } from './tts';
import type { RemoteEmbeddingProvider } from './embedding';

export type ApiProvider = RemoteLLMProvider | RemoteTTSProvider | RemoteEmbeddingProvider;
