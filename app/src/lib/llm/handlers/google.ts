/**
 * Google Gemini LLM Stream Handler — KeiAI
 *
 * Implements the LLMStreamHandler interface for Google's Gemini API.
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
import type { ToolCallRequest, ToolInputSchema } from '$lib/types/tools';

interface GeminiContent {
    role: string; // 'user' or 'model'
    parts: GeminiContentPart[];
}

type GeminiContentPart =
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
    | { functionCall: { id?: string; name: string; args: Record<string, unknown> } }
    | {
          functionResponse: {
              id?: string;
              name: string;
              response: { output: string; error?: boolean };
          };
      };

interface GeminiCompletion {
    candidates?: Array<{
        content?: {
            parts?: Array<{
                text?: string;
                functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
            }>;
        };
    }>;
}

export class GoogleLLMStreamHandler implements LLMStreamHandler {
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
        // Debounce stream to batch fast successive chunks (common with Gemini)
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
        const parsed = (await response.json()) as GeminiCompletion;
        const content =
            parsed.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
        const toolCalls = extractGeminiToolCalls(parsed);
        const result: LLMStreamContent = { content, thought: '' };
        if (toolCalls.length) result.toolCalls = toolCalls;
        yield result;
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

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;

                    const data = trimmed.slice(6);
                    if (data === '[DONE]') continue; // Not standard Gemini, but just in case

                    try {
                        const parsed = JSON.parse(data);
                        let changed = false;

                        const parts = parsed?.candidates?.[0]?.content?.parts ?? [];
                        for (const part of parts) {
                            if (part.text) {
                                state.content += part.text;
                                changed = true;
                            }
                        }
                        const toolCalls = extractGeminiToolCalls(parsed);
                        if (toolCalls.length) {
                            state.toolCalls = mergeGeminiToolCalls(
                                state.toolCalls ?? [],
                                toolCalls
                            );
                            changed = true;
                        }

                        if (changed) {
                            yield { ...state };
                        }
                    } catch (err) {
                        // Ignore parse errors from incomplete chunks if any
                    }
                }
            }

            // flush buffer
            if (buffer.trim().startsWith('data: ')) {
                try {
                    const parsed = JSON.parse(buffer.trim().slice(6));
                    const parts = parsed?.candidates?.[0]?.content?.parts ?? [];
                    for (const part of parts) {
                        if (part.text) state.content += part.text;
                    }
                    const toolCalls = extractGeminiToolCalls(parsed);
                    if (toolCalls.length)
                        state.toolCalls = mergeGeminiToolCalls(state.toolCalls ?? [], toolCalls);
                    if (parts.length > 0) {
                        yield { ...state };
                    }
                } catch (err) {
                    // Ignore
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
        const useStreaming = options.stream ?? true;
        const baseEndpoint = useStreaming
            ? `/models/${config.modelId}:streamGenerateContent`
            : `/models/${config.modelId}:generateContent`;
        const query = new URLSearchParams();
        if (useStreaming) query.set('alt', 'sse');
        if (config.apiKey) query.set('key', config.apiKey);
        const queryString = query.toString();
        const url = `${buildUrl(config.baseUrl, baseEndpoint)}${queryString ? `?${queryString}` : ''}`;
        const useProxy = config.useProxy ?? true;

        // Convert OpenAI messages to Gemini format
        const systemContent = messages.find((m) => m.role === 'system')?.content;
        const systemMessage = systemContent ? getTextContent(systemContent) : undefined;
        const chatMessages = messages.filter((m) => m.role !== 'system');

        const geminiMessages: GeminiContent[] = chatMessages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: toGeminiParts(m.content)
        }));

        const body: Record<string, unknown> = {
            contents: geminiMessages,
            generationConfig: {
                maxOutputTokens: options.maxResponse ?? 4096,
                temperature: parameters.temperature,
                topK: parameters.top_k,
                topP: parameters.top_p
            }
        };

        if (systemMessage) {
            body.systemInstruction = {
                role: 'user',
                parts: [{ text: systemMessage }]
            };
        }

        if (options.tools?.length) {
            body.tools = [
                {
                    functionDeclarations: options.tools.map((tool) => ({
                        name: tool.name,
                        description: tool.description,
                        parameters: toGeminiSchema(tool.inputSchema)
                    }))
                }
            ];
        }

        const response = await appHttp.fetch(
            url,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            },
            { proxy: useProxy, signal, retry: config.retry, timeout: config.timeout }
        );

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new AppError(
                'NETWORK_ERROR',
                `Google API error ${response.status}: ${errorBody || response.statusText}`
            );
        }

        return response;
    }
}

function toGeminiParts(content: LLMContentPart[]): GeminiContentPart[] {
    return content.map((part) => toGeminiPart(part));
}

function toGeminiPart(part: LLMContentPart): GeminiContentPart {
    if (part.type === 'text') return { text: part.text };
    if (part.type === 'image') {
        return { inlineData: { mimeType: part.mimeType, data: part.data } };
    }
    if (part.type === 'tool_request') {
        return {
            functionCall: { id: part.callId, name: part.name, args: part.args }
        };
    }
    return {
        functionResponse: {
            id: part.callId,
            name: part.name,
            response: {
                output: toolResponseToText(part.content),
                error: part.isError
            }
        }
    };
}

function extractGeminiToolCalls(completion: GeminiCompletion): ToolCallRequest[] {
    const result: ToolCallRequest[] = [];
    const parts = completion.candidates?.[0]?.content?.parts ?? [];
    for (const [index, part] of parts.entries()) {
        const call = part.functionCall;
        if (!call?.name) continue;
        result.push({
            callId: call.id ?? `${call.name}-${index}`,
            name: call.name,
            args: call.args ?? {}
        });
    }
    return result;
}

function mergeGeminiToolCalls(
    existing: ToolCallRequest[],
    incoming: ToolCallRequest[]
): ToolCallRequest[] {
    const merged = new Map(existing.map((call) => [call.callId, call]));
    for (const call of incoming) merged.set(call.callId, call);
    return [...merged.values()];
}

function toGeminiSchema(schema: ToolInputSchema): Record<string, unknown> {
    return {
        type: 'OBJECT',
        properties: Object.fromEntries(
            Object.entries(schema.properties).map(([name, property]) => [
                name,
                {
                    type: property.type.toUpperCase(),
                    description: property.description,
                    enum: property.enum
                }
            ])
        ),
        required: schema.required
    };
}

function toolResponseToText(
    content: Extract<LLMContentPart, { type: 'tool_response' }>['content']
): string {
    return content
        .map((part) => {
            if (part.type === 'text') return part.text;
            if (part.type === 'resource') return part.resource.text;
            return `[${part.type} result omitted]`;
        })
        .join('\n');
}
