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
    LLMFilePart,
    LLMMessage,
    LLMMediaPart,
    LLMOutputPart,
    LLMStreamContent,
    LLMStreamHandler,
    LLMStreamOptions,
    LLMTextPart,
    LLMToolRequestPart,
    LLMToolResponsePart,
    RemoteLLMHandlerConfig
} from '../types';
import { getTextContent } from '$lib/workflow/agent/llm';
import type { ToolCallResponsePart } from '$lib/types/tools';
import { AppError } from '$lib/types/errors';
import { appHttp } from '$lib/adapters/http';
import { toDataUrl } from '$lib/crypto';
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

type OpenAIRequestContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
    | { type: 'input_audio'; input_audio: { data: string; format: string } }
    | { type: 'video_url'; video_url: { url: string } }
    | { type: 'file'; file: { filename: string; file_data: string } };

type OpenAIRequestContent = string | OpenAIRequestContentPart[];
type OpenAIRegularPart = LLMTextPart | LLMMediaPart | LLMFilePart;

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
        const content = message?.content ?? '';
        const thought = message?.reasoning_content ?? '';
        const toolCalls = message?.tool_calls?.map((toolCall) => ({
            type: 'tool_request' as const,
            callId: toolCall.id ?? '',
            name: toolCall.function?.name ?? '',
            args: this.parseToolCallArgs(toolCall.function?.arguments ?? '')
        }));
        yield {
            parts: [
                ...(thought ? [{ type: 'thought' as const, text: thought }] : []),
                ...(content ? [{ type: 'text' as const, text: content }] : []),
                ...(toolCalls ?? [])
            ]
        };
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
                            content += delta.content;
                            changed = true;
                        }

                        if (delta.reasoning_content) {
                            thought += delta.reasoning_content;
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
                        state.parts = this.buildOutputParts(thought, content, toolCallMap);
                        yield { ...state };
                    }
                }
            }

            // Final yield for any remaining buffer
            if (buffer.trim()) {
                const parsed = this.parseLine(buffer);
                if (parsed) {
                    for (const choice of parsed.choices ?? []) {
                        if (choice.delta?.content) {
                            content += choice.delta.content;
                        }
                        if (choice.delta?.reasoning_content) {
                            thought += choice.delta.reasoning_content;
                        }
                    }
                    state.parts = this.buildOutputParts(thought, content, toolCallMap);
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
    ): LLMToolRequestPart[] {
        const calls: LLMToolRequestPart[] = [];
        for (const [, tc] of map) {
            calls.push({
                type: 'tool_request',
                callId: tc.id,
                name: tc.name,
                args: this.parseToolCallArgs(tc.args)
            });
        }
        return calls;
    }

    private buildOutputParts(
        thought: string,
        content: string,
        toolCalls: Map<number, { id: string; name: string; args: string }>
    ): LLMOutputPart[] {
        return [
            ...(thought ? [{ type: 'thought' as const, text: thought }] : []),
            ...(content ? [{ type: 'text' as const, text: content }] : []),
            ...this.buildToolCalls(toolCalls)
        ];
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
    const regularParts: OpenAIRegularPart[] = [];
    const toolRequests: LLMToolRequestPart[] = [];
    const toolResponses: LLMToolResponsePart[] = [];

    for (const part of message.content) {
        if (part.type === 'thought') continue;
        if (
            part.type === 'text' ||
            part.type === 'image' ||
            part.type === 'audio' ||
            part.type === 'video' ||
            part.type === 'file'
        ) {
            regularParts.push(part);
        } else if (part.type === 'tool_request') {
            toolRequests.push(part);
        } else {
            toolResponses.push(part);
        }
    }

    if (regularParts.length > 0 || toolRequests.length > 0) {
        const requestMessage: OpenAIRequestMessage = {
            role: message.role,
            content: null
        };

        const hasMedia = regularParts.some((part) => part.type !== 'text');
        if (hasMedia) {
            requestMessage.content = regularParts.map(toOpenAIContentPart);
        } else if (regularParts.length > 0) {
            let text = '';
            for (const part of regularParts) {
                if (part.type === 'text') text += part.text;
            }
            requestMessage.content = text;
        }

        if (toolRequests.length > 0) {
            requestMessage.tool_calls = [];
            for (const part of toolRequests) {
                requestMessage.tool_calls.push({
                    id: part.callId,
                    type: 'function',
                    function: {
                        name: part.name,
                        arguments: JSON.stringify(part.args)
                    }
                });
            }
        }

        result.push(requestMessage);
    }

    for (const part of toolResponses) {
        result.push({
            role: 'tool',
            content: toolResponseToText(part.content, part.isError),
            tool_call_id: part.callId
        });
    }
    return result;
}

function toOpenAIContentPart(part: OpenAIRegularPart): OpenAIRequestContentPart {
    if (part.type === 'text') return part;
    if (part.type === 'file') {
        return {
            type: 'file',
            file: {
                filename: part.name,
                file_data: part.data
            }
        };
    }
    if (part.type === 'audio') {
        return {
            type: 'input_audio',
            input_audio: { data: part.data, format: audioFormat(part.mimeType) }
        };
    }
    if (part.type === 'video') {
        return {
            type: 'video_url',
            video_url: { url: toDataUrl(part.mimeType, part.data) }
        };
    }
    return {
        type: 'image_url',
        image_url: { url: toDataUrl(part.mimeType, part.data) }
    };
}

function audioFormat(mimeType: string): string {
    const subtype = mimeType.toLowerCase().split('/')[1]?.split(';')[0];
    if (subtype === 'mpeg') return 'mp3';
    if (subtype === 'x-wav' || subtype === 'wave') return 'wav';
    return subtype || 'wav';
}

function toolResponseToText(content: ToolCallResponsePart[], isError?: boolean): string {
    const text = content
        .map((part) => {
            if (part.type === 'text') return part.text;
            if (part.type === 'resource') return part.resource.text;
            return `[${part.type} result omitted]`;
        })
        .join('\n');
    return isError ? `Error: ${text}` : text;
}
