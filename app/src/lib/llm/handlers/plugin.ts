import type {
    LLMStreamOptions,
    LLMStreamContent,
    LLMStreamHandler,
    PluginLLMHandlerConfig
} from '../types';
import type { LLMMessage } from '../types';
import type { PluginInstance } from '$lib/plugins';
import { debounceStream } from '$lib/utils/stream';

export class PluginLLMStreamHandler implements LLMStreamHandler {
    constructor(
        private readonly config: PluginLLMHandlerConfig,
        private readonly instance: PluginInstance,
        private readonly fnId: string
    ) {}

    async *stream(
        messages: LLMMessage[],
        signal: AbortSignal,
        options: LLMStreamOptions = {}
    ): AsyncIterable<LLMStreamContent> {
        const rawStream = this.rawStream(messages, signal, options);
        yield* debounceStream(rawStream);
    }

    private async *rawStream(
        messages: LLMMessage[],
        signal: AbortSignal,
        options: LLMStreamOptions
    ): AsyncIterable<LLMStreamContent> {
        const requestMessages = messages
            .map((message) => ({
                ...message,
                content: message.content.filter((part) => part.type !== 'thought')
            }))
            .filter((message) => message.content.length > 0);
        const streamConfig = {
            modelId: this.config.modelId,
            parameters: options.parameters,
            maxResponse: options.maxResponse,
            stream: options.stream ?? true,
            useProxy: this.config.useProxy,
            retry: this.config.retry,
            timeout: this.config.timeout,
            tools: options.tools
        };

        const rpcStream = this.instance.broker.invokeStream<unknown>(
            this.fnId,
            [requestMessages, streamConfig],
            signal
        );

        for await (const chunk of rpcStream) {
            if (!isLLMStreamContent(chunk)) {
                throw new Error('Plugin LLM provider returned invalid content');
            }
            yield chunk;
        }
    }
}

function isLLMStreamContent(value: unknown): value is LLMStreamContent {
    if (!value || typeof value !== 'object' || !('parts' in value)) return false;
    if (!Array.isArray(value.parts)) return false;

    return value.parts.every((part: unknown) => {
        if (!part || typeof part !== 'object' || !('type' in part)) return false;
        switch (part.type) {
            case 'text':
            case 'thought':
                return 'text' in part && typeof part.text === 'string';
            case 'image':
            case 'audio':
            case 'video':
                return (
                    'mimeType' in part &&
                    typeof part.mimeType === 'string' &&
                    'data' in part &&
                    typeof part.data === 'string'
                );
            case 'file':
                return (
                    'name' in part &&
                    typeof part.name === 'string' &&
                    'mimeType' in part &&
                    typeof part.mimeType === 'string' &&
                    'data' in part &&
                    typeof part.data === 'string'
                );
            case 'tool_request':
                return (
                    'callId' in part &&
                    typeof part.callId === 'string' &&
                    'name' in part &&
                    typeof part.name === 'string' &&
                    'args' in part &&
                    !!part.args &&
                    typeof part.args === 'object' &&
                    !Array.isArray(part.args)
                );
            default:
                return false;
        }
    });
}
