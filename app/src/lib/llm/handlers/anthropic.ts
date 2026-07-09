/**
 * Anthropic LLM Stream Handler — KeiAI
 *
 * Implements the LLMStreamHandler interface for Anthropic's Claude API.
 */

import type {
    LLMContentPart,
    LLMMessage,
    LLMStreamContent,
    LLMStreamHandler,
    LLMStreamOptions,
    RemoteLLMHandlerConfig
} from '../types';
import { getTextContent } from '../types';
import { AppError } from '$lib/types/errors';
import { appHttp } from '$lib/adapters/http';
import { debounceStream } from '$lib/utils/stream';
import { buildUrl } from '$lib/utils/url';

interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string | AnthropicContentBlock[];
}

type AnthropicContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

interface AnthropicCompletion {
    content?: Array<{
        type?: string;
        text?: string;
    }>;
}

export class AnthropicLLMStreamHandler implements LLMStreamHandler {
    private readonly config: RemoteLLMHandlerConfig;

    constructor(config: RemoteLLMHandlerConfig) {
        this.config = config;
    }

    async *stream(
        messages: LLMMessage[],
        signal: AbortSignal,
        options: LLMStreamOptions = {}
    ): AsyncIterable<LLMStreamContent> {
        const rawStream =
            (options.stream ?? true)
                ? this.rawStream(messages, signal, options)
                : this.complete(messages, signal, options);
        yield* debounceStream(rawStream);
    }

    private async *complete(
        messages: LLMMessage[],
        signal: AbortSignal,
        options: LLMStreamOptions
    ): AsyncIterable<LLMStreamContent> {
        const response = await this.fetchCompletion(messages, signal, {
            ...options,
            stream: false
        });
        const parsed = (await response.json()) as AnthropicCompletion;
        const content =
            parsed.content
                ?.filter((block) => block.type === 'text' && block.text)
                .map((block) => block.text)
                .join('') ?? '';
        yield { content, thought: '' };
    }

    private async *rawStream(
        messages: LLMMessage[],
        signal: AbortSignal,
        options: LLMStreamOptions
    ): AsyncIterable<LLMStreamContent> {
        const response = await this.fetchCompletion(messages, signal, { ...options, stream: true });
        const reader = response.body?.getReader();
        if (!reader) throw new AppError('NETWORK_ERROR', 'Response body is not readable');

        const state: LLMStreamContent = { content: '', thought: '' };
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                let currentEvent = '';

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        currentEvent = line.slice(7).trim();
                    } else if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();
                        if (currentEvent === 'content_block_delta') {
                            try {
                                const parsed = JSON.parse(data);
                                if (parsed.delta?.type === 'text_delta') {
                                    state.content += parsed.delta.text;
                                    yield { ...state };
                                }
                                // Optional: Support thought blocks if Anthropic adds reasoning deltas
                            } catch {
                                // Ignore parse error
                            }
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    private async fetchCompletion(
        messages: LLMMessage[],
        signal: AbortSignal,
        options: LLMStreamOptions
    ): Promise<Response> {
        const config = this.config;
        const parameters = options.parameters ?? {};
        const url = buildUrl(config.baseUrl, '/messages');
        const useProxy = config.useProxy ?? true;

        const systemContent = messages.find((m) => m.role === 'system')?.content;
        const systemMessage = systemContent ? getTextContent(systemContent) : undefined;
        const chatMessages = messages.filter((m) => m.role !== 'system');

        const anthropicMessages: AnthropicMessage[] = chatMessages.map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: toAnthropicContent(m.content)
        }));

        const response = await appHttp.fetch(
            url,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'anthropic-version': '2023-06-01',
                    ...(config.apiKey ? { 'x-api-key': config.apiKey } : {})
                },
                body: JSON.stringify({
                    model: config.modelId,
                    messages: anthropicMessages,
                    system: systemMessage,
                    stream: options.stream ?? true,
                    max_tokens: options.maxResponse ?? 4096,
                    temperature: parameters.temperature,
                    top_p: parameters.top_p,
                    top_k: parameters.top_k
                })
            },
            { proxy: useProxy, signal, retry: config.retry, timeout: config.timeout }
        );

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new AppError(
                'NETWORK_ERROR',
                `Anthropic API error ${response.status}: ${errorBody || response.statusText}`
            );
        }

        return response;
    }
}

function toAnthropicContent(content: LLMContentPart[]): string | AnthropicContentBlock[] {
    return content.some((part) => part.type === 'image')
        ? content.map(toAnthropicContentBlock)
        : getTextContent(content);
}

function toAnthropicContentBlock(part: LLMContentPart): AnthropicContentBlock {
    if (part.type === 'text') return part;

    return {
        type: 'image',
        source: { type: 'base64', media_type: part.mimeType, data: part.data }
    };
}
