/**
 * Google Gemini LLM Stream Handler — KeiAI
 *
 * Implements the LLMStreamHandler interface for Google's Gemini API.
 */

import type {
    LLMContentPart,
    LLMMessage,
    LLMOutputPart,
    LLMStreamContent,
    LLMStreamHandler,
    LLMStreamOptions,
    RemoteLLMHandlerConfig
} from '../types';
import { getTextContent } from '$lib/workflow/agent/llm';
import { AppError } from '$lib/types/errors';
import { officeFileToTextPart } from '$lib/llm/attachments';
import { fromBase64 } from '$lib/crypto';
import { appHttp } from '$lib/adapters/http';
import { debounceStream } from '$lib/utils/stream';
import { buildUrl } from '$lib/utils/url';
import type { ToolCallResponsePart, ToolInputSchema } from '$lib/types/tools';

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
            parts?: GeminiResponsePart[];
        };
    }>;
}

interface GeminiResponsePart {
    text?: string;
    thought?: boolean;
    inlineData?: { mimeType?: string; data?: string };
    functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
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
        const parts = extractGeminiOutputParts(parsed);
        const result: LLMStreamContent = { parts };
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

        const state: LLMStreamContent = { parts: [] };
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
                        const parsed = JSON.parse(data) as GeminiCompletion;
                        let changed = false;

                        const incomingParts = extractGeminiOutputParts(parsed);
                        for (const part of incomingParts) {
                            appendOutputPart(state, part);
                            changed = true;
                        }

                        if (changed) {
                            yield cloneStreamState(state);
                        }
                    } catch (err) {
                        // Ignore parse errors from incomplete chunks if any
                    }
                }
            }

            // flush buffer
            if (buffer.trim().startsWith('data: ')) {
                try {
                    const parsed = JSON.parse(buffer.trim().slice(6)) as GeminiCompletion;
                    const parts = extractGeminiOutputParts(parsed);
                    for (const part of parts) appendOutputPart(state, part);
                    if (parts.length > 0) {
                        yield cloneStreamState(state);
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

        const geminiMessages: GeminiContent[] = chatMessages
            .map((message) => ({
                role: message.role === 'assistant' ? 'model' : 'user',
                parts: toGeminiParts(message.content)
            }))
            .filter((message) => message.parts.length > 0);

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
    const parts: GeminiContentPart[] = [];
    for (const part of content) {
        const converted = toGeminiPart(part);
        if (converted) parts.push(converted);
    }
    return parts;
}

function toGeminiPart(part: LLMContentPart): GeminiContentPart | null {
    if (part.type === 'thought') return null;
    if (part.type === 'text') return { text: part.text };
    if (
        part.type === 'image' ||
        part.type === 'audio' ||
        part.type === 'video' ||
        part.type === 'file'
    ) {
        // Gemini only accepts PDF natively; Office attachments must be converted to text.
        if (part.type === 'file') {
            const fallback = officeFileToTextPart(part.name, part.mimeType, fromBase64(part.data));
            if (fallback) return { text: fallback.text };
        }
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

function extractGeminiOutputParts(completion: GeminiCompletion): LLMOutputPart[] {
    const result: LLMOutputPart[] = [];
    for (const [index, part] of (completion.candidates?.[0]?.content?.parts ?? []).entries()) {
        if (part.text) {
            result.push({ type: part.thought ? 'thought' : 'text', text: part.text });
            continue;
        }
        const call = part.functionCall;
        if (call?.name) {
            result.push({
                type: 'tool_request',
                callId: call.id ?? `${call.name}-${index}`,
                name: call.name,
                args: call.args ?? {}
            });
            continue;
        }
        const inlineData = part.inlineData;
        if (!inlineData?.mimeType || !inlineData.data) continue;
        const topLevelType = inlineData.mimeType.split('/', 1)[0];
        if (topLevelType !== 'image' && topLevelType !== 'audio' && topLevelType !== 'video') {
            continue;
        }
        result.push({
            type: topLevelType,
            mimeType: inlineData.mimeType,
            data: inlineData.data
        });
    }
    return result;
}

function appendOutputPart(state: LLMStreamContent, incoming: LLMOutputPart): void {
    const previous = state.parts.at(-1);
    if (incoming.type === 'text' || incoming.type === 'thought') {
        if (previous?.type === incoming.type) {
            state.parts[state.parts.length - 1] = {
                type: incoming.type,
                text: previous.text + incoming.text
            };
            return;
        }
    }
    if (incoming.type === 'tool_request') {
        const index = state.parts.findIndex(
            (part) => part.type === 'tool_request' && part.callId === incoming.callId
        );
        if (index >= 0) {
            state.parts[index] = incoming;
            return;
        }
    }
    state.parts.push(incoming);
}

function cloneStreamState(state: LLMStreamContent): LLMStreamContent {
    return {
        ...state,
        parts: state.parts.map((part) =>
            part.type === 'tool_request' ? { ...part, args: { ...part.args } } : { ...part }
        )
    };
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

function toolResponseToText(content: ToolCallResponsePart[]): string {
    return content
        .map((part) => {
            if (part.type === 'text') return part.text;
            if (part.type === 'resource') return part.resource.text;
            return `[${part.type} result omitted]`;
        })
        .join('\n');
}
