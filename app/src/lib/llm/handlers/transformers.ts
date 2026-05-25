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
    LLMStreamOptions,
    OpenAIChat,
    LLMStreamHandlerConfig
} from '../types';
import { debounceStream } from '$lib/utils/stream';

export class TransformersLLMStreamHandler implements LLMStreamHandler {
    private readonly config: LLMStreamHandlerConfig;

    constructor(config: LLMStreamHandlerConfig) {
        this.config = config;
    }

    async *stream(
        messages: OpenAIChat[],
        _signal: AbortSignal,
        options: LLMStreamOptions = {}
    ): AsyncIterable<LLMStreamContent> {
        const rawStream = this.rawStream(messages, options);
        yield* debounceStream(rawStream);
    }

    private async *rawStream(
        messages: OpenAIChat[],
        options: LLMStreamOptions
    ): AsyncIterable<LLMStreamContent> {
        const parameters = options.parameters ?? {};
        const stream = appInference.generate({ modelId: this.config.modelId }, messages, {
            device: 'webgpu', // LLM generation strongly prefers WebGPU
            max_new_tokens: options.maxResponse ?? 512,
            temperature: (parameters['temperature'] as number) ?? 0.7,
            top_p: (parameters['top_p'] as number) ?? 0.9,
            top_k: (parameters['top_k'] as number) ?? 50,
            repetition_penalty: (parameters['frequency_penalty'] as number) ?? 1.1
        });

        let fullContent = '';
        for await (const chunk of stream) {
            fullContent += chunk;
            yield { content: fullContent };
        }
    }
}
