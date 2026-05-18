import type { LLMStreamContent, LLMStreamHandler, PluginLLMHandlerConfig } from '../types';
import type { OpenAIChat } from '../types';
import type { PluginInstance } from '$lib/plugins';
import { debounceStream } from '$lib/utils/stream';

export class PluginLLMStreamHandler implements LLMStreamHandler {
    constructor(
        private readonly config: PluginLLMHandlerConfig,
        private readonly instance: PluginInstance,
        private readonly fnId: string
    ) {}

    async *stream(messages: OpenAIChat[], signal: AbortSignal): AsyncIterable<LLMStreamContent> {
        const rawStream = this.rawStream(messages, signal);
        yield* debounceStream(rawStream);
    }

    private async *rawStream(
        messages: OpenAIChat[],
        signal: AbortSignal
    ): AsyncIterable<LLMStreamContent> {
        const streamConfig = {
            modelId: this.config.modelId,
            parameters: this.config.parameters,
            useProxy: this.config.useProxy,
            retry: this.config.retry,
            timeout: this.config.timeout
        };

        const rpcStream = this.instance.broker.invokeStream<LLMStreamContent>(
            this.fnId,
            [messages, streamConfig],
            signal
        );

        for await (const chunk of rpcStream) {
            yield chunk;
        }
    }
}
