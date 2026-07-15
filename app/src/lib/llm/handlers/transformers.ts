/**
 * Transformers LLM Stream Handler — KeiAI
 *
 * Implements LLMStreamHandler using the local inference adapter.
 * Handles continuous text generation using WebGPU via transformers.js.
 */

import { appInference } from '$lib/adapters/inference';
import { getTextContent } from '../types';
import type {
    LLMStreamHandler,
    LLMStreamContent,
    LLMStreamOptions,
    LLMMessage,
    LLMStreamHandlerConfig
} from '../types';
import { debounceStream } from '$lib/utils/stream';

export class TransformersLLMStreamHandler implements LLMStreamHandler {
    private readonly config: LLMStreamHandlerConfig;

    constructor(config: LLMStreamHandlerConfig) {
        this.config = config;
    }

    async *stream(
        messages: LLMMessage[],
        _signal: AbortSignal,
        options: LLMStreamOptions = {}
    ): AsyncIterable<LLMStreamContent> {
        const rawStream = this.rawStream(messages, options);
        yield* debounceStream(rawStream);
    }

    private async *rawStream(
        messages: LLMMessage[],
        options: LLMStreamOptions
    ): AsyncIterable<LLMStreamContent> {
        const parameters = options.parameters ?? {};
        const textMessages = messages.map((message) => ({
            role: message.role,
            content: getTextContent(message.content)
        }));
        const stream = appInference.generate({ modelId: this.config.modelId }, textMessages, {
            device: 'webgpu', // LLM generation strongly prefers WebGPU
            max_new_tokens: options.maxResponse ?? 512,
            temperature: (parameters['temperature'] as number) ?? 0.7,
            top_p: (parameters['top_p'] as number) ?? 0.9,
            top_k: (parameters['top_k'] as number) ?? 50,
            repetition_penalty: (parameters['frequency_penalty'] as number) ?? 1.1
        });

        let fullContent = '';
        const shouldStream = options.stream ?? true;
        for await (const chunk of stream) {
            fullContent += chunk;
            if (shouldStream) yield { content: fullContent };
        }
        if (!shouldStream) yield { content: fullContent };
    }
}
