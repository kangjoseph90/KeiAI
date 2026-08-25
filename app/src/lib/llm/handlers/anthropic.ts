/**
 * Anthropic LLM Stream Handler — KeiAI
 *
 * Implements the LLMStreamHandler interface for Anthropic's Claude API.
 */

import type {
    LLMContentPart,
    LLMMessage,
    LLMOutputPart,
    LLMStreamContent,
    LLMStreamHandler,
    LLMStreamOptions,
    LLMToolRequestPart,
    RemoteLLMHandlerConfig
} from '../types';
import { getTextContent } from '$lib/workflow/agent/llm';
import type { ToolCallResponsePart } from '$lib/types/tools';
import { AppError } from '$lib/types/errors';
import { appHttp } from '$lib/adapters/http';
import { debounceStream } from '$lib/utils/stream';
import { buildUrl } from '$lib/utils/url';
import { fromBase64 } from '$lib/crypto';
import { officeFileToTextPart } from '$lib/llm/attachments';

interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string | AnthropicContentBlock[];
}

type AnthropicContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    | {
          type: 'tool_result';
          tool_use_id: string;
          content: string;
          is_error?: boolean;
      };

interface AnthropicCompletionBlock {
    type?: string;
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
}

interface AnthropicCompletion {
    content?: AnthropicCompletionBlock[];
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
        yield { parts: extractAnthropicOutputParts(parsed.content ?? []) };
    }

    private async *rawStream(
        messages: LLMMessage[],
        signal: AbortSignal,
        options: LLMStreamOptions
    ): AsyncIterable<LLMStreamContent> {
        const response = await this.fetchCompletion(messages, signal, { ...options, stream: true });
        const reader = response.body?.getReader();
        if (!reader) throw new AppError('NETWORK_ERROR', 'Response body is not readable');

        let content = '';
        let thought = '';
        const state: LLMStreamContent = { parts: [] };
        const decoder = new TextDecoder();
        let buffer = '';
        const toolCallMap = new Map<
            number,
            { id: string; name: string; input: string | Record<string, unknown> }
        >();
        let currentEvent = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        currentEvent = line.slice(7).trim();
                    } else if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();
                        if (currentEvent === 'content_block_start') {
                            try {
                                const parsed = JSON.parse(data);
                                if (parsed.content_block?.type === 'tool_use') {
                                    toolCallMap.set(parsed.index ?? toolCallMap.size, {
                                        id: parsed.content_block.id ?? '',
                                        name: parsed.content_block.name ?? '',
                                        input: parsed.content_block.input ?? ''
                                    });
                                    state.parts = buildAnthropicStreamParts(
                                        thought,
                                        content,
                                        toolCallMap
                                    );
                                    yield { ...state };
                                }
                            } catch {
                                // Ignore malformed stream events.
                            }
                        } else if (currentEvent === 'content_block_delta') {
                            try {
                                const parsed = JSON.parse(data);
                                if (parsed.delta?.type === 'text_delta') {
                                    content += parsed.delta.text;
                                    state.parts = buildAnthropicStreamParts(
                                        thought,
                                        content,
                                        toolCallMap
                                    );
                                    yield { ...state };
                                } else if (parsed.delta?.type === 'thinking_delta') {
                                    thought += parsed.delta.thinking ?? '';
                                    state.parts = buildAnthropicStreamParts(
                                        thought,
                                        content,
                                        toolCallMap
                                    );
                                    yield { ...state };
                                } else if (parsed.delta?.type === 'input_json_delta') {
                                    const index = parsed.index ?? 0;
                                    const current = toolCallMap.get(index);
                                    if (current) {
                                        current.input =
                                            typeof current.input === 'string'
                                                ? current.input + (parsed.delta.partial_json ?? '')
                                                : (parsed.delta.partial_json ?? '');
                                        state.parts = buildAnthropicStreamParts(
                                            thought,
                                            content,
                                            toolCallMap
                                        );
                                        yield { ...state };
                                    }
                                }
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

        const anthropicMessages: AnthropicMessage[] = chatMessages
            .map(
                (message): AnthropicMessage => ({
                    role: message.role === 'assistant' ? 'assistant' : 'user',
                    content: toAnthropicContent(message.content)
                })
            )
            .filter((message) => message.content.length > 0);

        const body: Record<string, unknown> = {
            model: config.modelId,
            messages: anthropicMessages,
            system: systemMessage,
            stream: options.stream ?? true,
            max_tokens: options.maxResponse ?? 4096,
            temperature: parameters.temperature,
            top_p: parameters.top_p,
            top_k: parameters.top_k
        };
        if (options.tools?.length) {
            body.tools = options.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema
            }));
        }

        const response = await appHttp.fetch(
            url,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'anthropic-version': '2023-06-01',
                    ...(config.apiKey ? { 'x-api-key': config.apiKey } : {})
                },
                body: JSON.stringify(body)
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
    const blocks: AnthropicContentBlock[] = [];
    for (const part of content) {
        const converted = toAnthropicContentBlock(part);
        if (converted) blocks.push(converted);
    }
    return blocks.every((part) => part.type === 'text')
        ? blocks.map((part) => (part.type === 'text' ? part.text : '')).join('')
        : blocks;
}

function toAnthropicContentBlock(part: LLMContentPart): AnthropicContentBlock | null {
    if (part.type === 'thought') return null;
    if (part.type === 'text') return part;
    if (part.type === 'image') {
        return {
            type: 'image',
            source: { type: 'base64', media_type: part.mimeType, data: part.data }
        };
    }
    if (part.type === 'file') {
        if (part.mimeType !== 'application/pdf') {
            const fallback = officeFileToTextPart(part.name, part.mimeType, fromBase64(part.data));
            if (fallback) return fallback;
            throw new AppError(
                'INVALID_INPUT',
                `Anthropic does not support native ${part.mimeType} attachments`
            );
        }
        return {
            type: 'document',
            source: { type: 'base64', media_type: part.mimeType, data: part.data }
        };
    }
    if (part.type === 'audio' || part.type === 'video') {
        throw new AppError(
            'INVALID_INPUT',
            `Anthropic handler does not support ${part.type} input`
        );
    }
    if (part.type === 'tool_request') {
        return { type: 'tool_use', id: part.callId, name: part.name, input: part.args };
    }
    return {
        type: 'tool_result',
        tool_use_id: part.callId,
        content: toolResponseToText(part.content),
        is_error: part.isError
    };
}

function buildAnthropicToolCalls(
    calls: ReadonlyMap<
        number,
        { id: string; name: string; input: string | Record<string, unknown> }
    >
): LLMToolRequestPart[] {
    return [...calls.values()].map((call) => ({
        type: 'tool_request',
        callId: call.id,
        name: call.name,
        args: typeof call.input === 'string' ? parseToolArgs(call.input) : call.input
    }));
}

function buildAnthropicStreamParts(
    thought: string,
    content: string,
    calls: ReadonlyMap<
        number,
        { id: string; name: string; input: string | Record<string, unknown> }
    >
): LLMOutputPart[] {
    return [
        ...(thought ? [{ type: 'thought' as const, text: thought }] : []),
        ...(content ? [{ type: 'text' as const, text: content }] : []),
        ...buildAnthropicToolCalls(calls)
    ];
}

function extractAnthropicOutputParts(blocks: AnthropicCompletionBlock[]): LLMOutputPart[] {
    const parts: LLMOutputPart[] = [];
    for (const block of blocks) {
        if (block.type === 'thinking' && block.thinking) {
            parts.push({ type: 'thought', text: block.thinking });
        } else if (block.type === 'text' && block.text) {
            parts.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use' && block.id && block.name) {
            parts.push({
                type: 'tool_request',
                callId: block.id,
                name: block.name,
                args: block.input ?? {}
            });
        }
    }
    return parts;
}

function parseToolArgs(input: string): Record<string, unknown> {
    if (!input) return {};
    try {
        const parsed = JSON.parse(input) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : { value: parsed };
    } catch {
        return { _raw: input };
    }
}

function toolResponseToText(content: ToolCallResponsePart[]): string {
    return content
        .map((part) => {
            if (part.type === 'text') return part.text;
            if (part.type === 'resource') return part.resource.text;
            return `[${part.type} result omitted]`;
        })
        .join('\n');
}
