/**
 * Transformers LLM Stream Handler — KeiAI
 *
 * Implements LLMStreamHandler using the local inference adapter.
 * Handles continuous text generation using WebGPU via transformers.js.
 */

import { appInference } from '$lib/adapters/inference';
import type {
    LLMStreamHandler,
    LLMStreamContent,
    OpenAIChat,
    LLMStreamHandlerConfig
} from '../types';
import { debounceStream } from '$lib/utils/stream';

export class TransformersLLMStreamHandler implements LLMStreamHandler {
    private readonly config: LLMStreamHandlerConfig;

    constructor(config: LLMStreamHandlerConfig) {
        this.config = config;
    }

    async *stream(messages: OpenAIChat[], _signal: AbortSignal): AsyncIterable<LLMStreamContent> {
        const rawStream = this.rawStream(messages);
        yield* debounceStream(rawStream, this.config.debounce);
    }

    private async *rawStream(messages: OpenAIChat[]): AsyncIterable<LLMStreamContent> {
        const stream = appInference.generate({ modelId: this.config.modelId }, messages, {
            device: 'webgpu', // LLM generation strongly prefers WebGPU
            max_new_tokens:
                (this.config.parameters as Record<string, number | undefined>)?.['max_tokens'] ??
                512,
            temperature: (this.config.parameters?.['temperature'] as number) ?? 0.7,
            top_p: (this.config.parameters?.['top_p'] as number) ?? 0.9,
            top_k: (this.config.parameters?.['top_k'] as number) ?? 50,
            repetition_penalty: (this.config.parameters?.['frequency_penalty'] as number) ?? 1.1
        });

        let fullContent = '';
        for await (const chunk of stream) {
            fullContent += chunk;
            yield { content: fullContent };
        }
    }
}
