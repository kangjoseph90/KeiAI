/**
 * Google Gemini LLM Stream Handler — KeiAI
 *
 * Implements the LLMStreamHandler interface for Google's Gemini API.
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

interface GeminiContent {
	role: string; // 'user' or 'model'
	parts: Array<{ text: string }>;
}

export class GoogleLLMStreamHandler implements LLMStreamHandler {
	private readonly config: RemoteLLMHandlerConfig;

	constructor(config: RemoteLLMHandlerConfig) {
		this.config = config;
	}

	async *stream(messages: OpenAIChat[], signal: AbortSignal): AsyncIterable<LLMStreamContent> {
		const rawStream = this.rawStream(messages, signal);
		// Debounce stream to batch fast successive chunks (common with Gemini)
		yield* debounceStream(rawStream, this.config.debounce);
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

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || !trimmed.startsWith('data: ')) continue;

					const data = trimmed.slice(6);
					if (data === '[DONE]') continue; // Not standard Gemini, but just in case

					try {
						const parsed = JSON.parse(data);
						let changed = false;

						const textPart = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
						if (textPart) {
							state.content += textPart;
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
					const textPart = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
					if (textPart) {
						state.content += textPart;
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

	private async fetchStream(messages: OpenAIChat[], signal: AbortSignal): Promise<Response> {
		const config = this.config;
		const baseEndpoint = `/models/${config.modelId}:streamGenerateContent?alt=sse`;
		const url = `${buildUrl(config.baseUrl, baseEndpoint)}${config.apiKey ? `&key=${config.apiKey}` : ''}`;
		const useProxy = config.useProxy ?? true;

		// Convert OpenAI messages to Gemini format
		const systemMessage = messages.find((m) => m.role === 'system')?.content;
		const chatMessages = messages.filter((m) => m.role !== 'system');

		const geminiMessages: GeminiContent[] = chatMessages.map((m) => ({
			role: m.role === 'assistant' ? 'model' : 'user',
			parts: [{ text: m.content }]
		}));

		const body: Record<string, unknown> = {
			contents: geminiMessages,
			generationConfig: {
				temperature: config.parameters?.temperature,
				topK: config.parameters?.top_k,
				topP: config.parameters?.top_p
			}
		};

		if (systemMessage) {
			body.systemInstruction = {
				role: 'user',
				parts: [{ text: systemMessage }]
			};
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
