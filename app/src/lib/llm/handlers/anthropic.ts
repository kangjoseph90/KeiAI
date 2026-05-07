/**
 * Anthropic LLM Stream Handler — KeiAI
 *
 * Implements the LLMStreamHandler interface for Anthropic's Claude API.
 */

import type {
    LLMStreamContent,
    LLMStreamHandler,
    OpenAIChat,
    RemoteLLMHandlerConfig
} from '../types';
import { AppError } from '$lib/types/errors';
import { appHttp } from '$lib/adapters/http';
import { debounceStream } from '$lib/utils/stream';
import { buildUrl } from '$lib/utils/url';

interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string;
}

export class AnthropicLLMStreamHandler implements LLMStreamHandler {
    private readonly config: RemoteLLMHandlerConfig;

    constructor(config: RemoteLLMHandlerConfig) {
        this.config = config;
    }

    async *stream(messages: OpenAIChat[], signal: AbortSignal): AsyncIterable<LLMStreamContent> {
        const rawStream = this.rawStream(messages, signal);
        yield* debounceStream(rawStream);
    }

    private async *rawStream(
        messages: OpenAIChat[],
        signal: AbortSignal
    ): AsyncIterable<LLMStreamContent> {
        const response = await this.fetchStream(messages, signal);
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

    private async fetchStream(messages: OpenAIChat[], signal: AbortSignal): Promise<Response> {
        const config = this.config;
        const url = buildUrl(config.baseUrl, '/messages');
        const useProxy = config.useProxy ?? true;

        const systemMessage = messages.find((m) => m.role === 'system')?.content;
        const chatMessages = messages.filter((m) => m.role !== 'system');

        const anthropicMessages: AnthropicMessage[] = chatMessages.map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content
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
                    stream: true,
                    max_tokens:
                        (config.parameters as Record<string, number | undefined>)?.['max_tokens'] ??
                        4096,
                    temperature: config.parameters?.temperature,
                    top_p: config.parameters?.top_p,
                    top_k: config.parameters?.top_k
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
