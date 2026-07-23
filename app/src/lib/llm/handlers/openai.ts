/**
 * OpenAI-Compatible Stream Handler — KeiAI
 *
 * Implements the LLMStreamHandler interface for any OpenAI-compatible API.
 * Covers: OpenAI, OpenRouter, Ollama, vLLM, LM Studio, and any other
 * service that speaks the OpenAI Chat Completions SSE format.
 *
 * CONTRACT: Yields cumulative content (e.g. "1", "12", "123").
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
import type { ToolCallRequest } from '$lib/types/tools';
import { AppError } from '$lib/types/errors';
import { appHttp } from '$lib/adapters/http';
import { debounceStream } from '$lib/utils/stream';
import { buildUrl } from '$lib/utils/url';
import { createLogger } from '$lib/adapters/logger';

const logger = createLogger('llm:openai-compat');

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape of a single SSE chunk from OpenAI's streaming API */
interface OpenAIDelta {
    choices?: Array<{
        delta?: {
            content?: string | null;
            reasoning_content?: string | null;
            tool_calls?: Array<{
                index: number;
                id?: string;
                function?: {
                    name?: string;
                    arguments?: string;
                };
            }>;
        };
        finish_reason?: string | null;
    }>;
}

interface OpenAICompletion {
    choices?: Array<{
        message?: {
            content?: string | null;
            reasoning_content?: string | null;
            tool_calls?: Array<{
                id?: string;
                function?: {
                    name?: string;
                    arguments?: string;
                };
            }>;
        };
    }>;
}

type OpenAIRequestContent =
    | string
    | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

interface OpenAIRequestMessage {
    role: LLMMessage['role'] | 'tool';
    content: OpenAIRequestContent | null;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class OpenAILLMStreamHandler implements LLMStreamHandler {
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
        const response = await this.fetchCompletion(messages, signal, options);
        const parsed = (await response.json()) as OpenAICompletion;
        const message = parsed.choices?.[0]?.message;
        const state: LLMStreamContent = {
            content: message?.content ?? '',
            thought: message?.reasoning_content ?? ''
        };
        const toolCalls = message?.tool_calls?.map((toolCall) => ({
            callId: toolCall.id ?? '',
            name: toolCall.function?.name ?? '',
            args: this.parseToolCallArgs(toolCall.function?.arguments ?? '')
        }));
        if (toolCalls && toolCalls.length > 0) state.toolCalls = toolCalls;
        yield state;
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
        // Accumulate partial tool call arguments string by index
        const toolCallMap = new Map<number, { id: string; name: string; args: string }>();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                // Keep last incomplete line in buffer
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    const parsed = this.parseLine(line);
                    if (!parsed) continue;

                    let changed = false;

                    for (const choice of parsed.choices ?? []) {
                        const delta = choice.delta;
                        if (!delta) continue;

                        if (delta.content) {
                            state.content += delta.content;
                            changed = true;
                        }

                        if (delta.reasoning_content) {
                            state.thought = (state.thought ?? '') + delta.reasoning_content;
                            changed = true;
                        }

                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                const existing = toolCallMap.get(tc.index);
                                if (!existing) {
                                    toolCallMap.set(tc.index, {
                                        id: tc.id ?? '',
                                        name: tc.function?.name ?? '',
                                        args: tc.function?.arguments ?? ''
                                    });
                                } else {
                                    if (tc.function?.arguments) {
                                        existing.args += tc.function.arguments;
                                    }
                                }
                            }
                            changed = true;
                        }
                    }

                    if (changed) {
                        if (toolCallMap.size > 0) {
                            state.toolCalls = this.buildToolCalls(toolCallMap);
                        }
                        yield { ...state };
                    }
                }
            }

            // Final yield for any remaining buffer
            if (buffer.trim()) {
                const parsed = this.parseLine(buffer);
                if (parsed) {
                    for (const choice of parsed.choices ?? []) {
                        if (choice.delta?.content) state.content += choice.delta.content;
                        if (choice.delta?.reasoning_content) {
                            state.thought = (state.thought ?? '') + choice.delta.reasoning_content;
                        }
                    }
                    if (toolCallMap.size > 0) {
                        state.toolCalls = this.buildToolCalls(toolCallMap);
                    }
                    yield { ...state };
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    // ─── Internals ──────────────────────────────────────────────────────────

    private async fetchCompletion(
        messages: LLMMessage[],
        signal: AbortSignal,
        options: LLMStreamOptions
    ): Promise<Response> {
        const config = this.config;
        const parameters = options.parameters ?? {};
        const url = buildUrl(config.baseUrl, '/chat/completions');
        const useProxy = config.useProxy ?? true;

        const body: Record<string, unknown> = {
            ...parameters,
            max_tokens: options.maxResponse ?? 4096,
            model: config.modelId,
            messages: messages.flatMap(toOpenAIRequestMessages),
            stream: options.stream ?? true
        };
        if (options.tools?.length) {
            body.tools = options.tools.map((tool) => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema
                }
            }));
        }

        const response = await appHttp.fetch(
            url,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
                },
                body: JSON.stringify(body)
            },
            { proxy: useProxy, signal, retry: config.retry, timeout: config.timeout }
        );

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new AppError(
                'NETWORK_ERROR',
                `API error ${response.status}: ${errorBody || response.statusText}`
            );
        }

        return response;
    }

    private parseLine(line: string): OpenAIDelta | null {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) return null;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return null;

        try {
            return JSON.parse(data) as OpenAIDelta;
        } catch {
            return null;
        }
    }

    private buildToolCalls(
        map: Map<number, { id: string; name: string; args: string }>
    ): ToolCallRequest[] {
        const calls: ToolCallRequest[] = [];
        for (const [, tc] of map) {
            calls.push({ callId: tc.id, name: tc.name, args: this.parseToolCallArgs(tc.args) });
        }
        return calls;
    }

    private parseToolCallArgs(args: string): Record<string, unknown> {
        try {
            const parsed = JSON.parse(args) as unknown;
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? (parsed as Record<string, unknown>)
                : { value: parsed };
        } catch {
            // Args may still be partial while streaming.
            return { _raw: args };
        }
    }
}

function toOpenAIRequestMessages(message: LLMMessage): OpenAIRequestMessage[] {
    const result: OpenAIRequestMessage[] = [];
    let regularParts: Array<Extract<LLMContentPart, { type: 'text' | 'image' }>> = [];

    const flushRegularParts = (): void => {
        if (regularParts.length === 0) return;
        const hasImage = regularParts.some((part) => part.type === 'image');
        result.push({
            role: message.role,
            content: hasImage ? regularParts.map(toOpenAIContentPart) : getTextContent(regularParts)
        });
        regularParts = [];
    };

    for (const part of message.content) {
        if (part.type === 'text' || part.type === 'image') {
            regularParts.push(part);
            continue;
        }
        flushRegularParts();
        if (part.type === 'tool_request') {
            result.push({
                role: 'assistant',
                content: null,
                tool_calls: [
                    {
                        id: part.callId,
                        type: 'function',
                        function: { name: part.name, arguments: JSON.stringify(part.args) }
                    }
                ]
            });
        } else {
            result.push({
                role: 'tool',
                tool_call_id: part.callId,
                content: toolResponseToText(part.content, part.isError)
            });
        }
    }
    flushRegularParts();
    return result;
}

function toOpenAIContentPart(
    part: Extract<LLMContentPart, { type: 'text' | 'image' }>
): Extract<OpenAIRequestContent, ReadonlyArray<unknown>>[number] {
    if (part.type === 'text') return part;
    return {
        type: 'image_url',
        image_url: { url: `data:${part.mimeType};base64,${part.data}` }
    };
}

function toolResponseToText(
    content: Extract<LLMContentPart, { type: 'tool_response' }>['content'],
    isError?: boolean
): string {
    const text = content
        .map((part) => {
            if (part.type === 'text') return part.text;
            if (part.type === 'resource') return part.resource.text;
            return `[${part.type} result omitted]`;
        })
        .join('\n');
    return isError ? `Error: ${text}` : text;
}
