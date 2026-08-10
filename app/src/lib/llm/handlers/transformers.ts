/**
 * Transformers LLM Stream Handler — KeiAI
 *
 * Implements LLMStreamHandler using the local Transformers.js runtime.
 * Handles continuous text generation using WebGPU via transformers.js.
 */

import { gemma4, qwen35, transformers } from '$lib/inference';
import { getTextContent } from '$lib/workflow/agent/llm';
import type { GenerateOptions, MultimodalGenerateMessage } from '$lib/inference/types';
import type { TransformersLLMRuntime } from '$lib/types/models/llm';
import type {
    LLMStreamHandler,
    LLMStreamContent,
    LLMStreamOptions,
    LLMMessage,
    LLMStreamHandlerConfig,
    LLMContentPart
} from '../types';
import { debounceStream } from '$lib/utils/stream';

interface TransformersLLMStreamHandlerConfig extends LLMStreamHandlerConfig {
    runtime: TransformersLLMRuntime;
}

export class TransformersLLMStreamHandler implements LLMStreamHandler {
    private readonly config: TransformersLLMStreamHandlerConfig;

    constructor(config: TransformersLLMStreamHandlerConfig) {
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
        const generationOptions = {
            device: 'webgpu', // LLM generation strongly prefers WebGPU
            max_new_tokens: options.maxResponse ?? 512,
            temperature: parameters['temperature'] as number | undefined,
            top_p: parameters['top_p'] as number | undefined,
            top_k: parameters['top_k'] as number | undefined,
            repetition_penalty: parameters['frequency_penalty'] as number | undefined
        } as const;
        const stream = this.generate(messages, generationOptions);

        let fullContent = '';
        const shouldStream = options.stream ?? true;
        for await (const chunk of stream) {
            fullContent += chunk;
            if (shouldStream) yield { parts: [{ type: 'text', text: fullContent }] };
        }
        if (!shouldStream) yield { parts: [{ type: 'text', text: fullContent }] };
    }

    private generate(messages: LLMMessage[], options: GenerateOptions): AsyncIterable<string> {
        switch (this.config.runtime.kind) {
            case 'pipeline':
                return transformers.generate(
                    { modelId: this.config.modelId },
                    messages.map((message) => ({
                        role: message.role,
                        content: getTextContent(message.content)
                    })),
                    options
                );
            case 'gemma4':
                return gemma4.generate(
                    { modelId: this.config.modelId },
                    toMultimodalMessages(messages),
                    options
                );
            case 'qwen35':
                return qwen35.generate(
                    { modelId: this.config.modelId },
                    toMultimodalMessages(messages),
                    options
                );
        }
    }
}

function toMultimodalMessages(messages: LLMMessage[]): MultimodalGenerateMessage[] {
    return messages.map((message) => ({
        role: message.role,
        content: message.content.flatMap(toMultimodalPart)
    }));
}

function toMultimodalPart(part: LLMContentPart): MultimodalGenerateMessage['content'] {
    switch (part.type) {
        case 'text':
            return [{ type: 'text', text: part.text }];
        case 'image':
        case 'audio':
            return [{ type: part.type, mimeType: part.mimeType, data: part.data }];
        default:
            return [];
    }
}
