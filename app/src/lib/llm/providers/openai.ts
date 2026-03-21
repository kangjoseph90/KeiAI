/**
 * OpenAI-Compatible Stream Provider — KeiAI
 *
 * Implements the StreamProvider interface for any OpenAI-compatible API.
 * Covers: OpenAI, OpenRouter, Ollama, vLLM, LM Studio, and any other
 * service that speaks the OpenAI Chat Completions SSE format.
 *
 * CONTRACT: Yields cumulative content (e.g. "1", "12", "123").
 */

import type {
	StreamContent,
	StreamProvider,
	OpenAIChat,
	StreamModelConfig,
	StreamHttpConfig
} from '../types';
import type { ToolCallRequest } from '$lib/services/content/tool';
import { AppError } from '$lib/types/errors';
import { appHttp } from '$lib/adapters/http';
import { debounceStream, type StreamDebounceConfig } from './debounce';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpenAIProviderConfig {
	model: StreamModelConfig;
	http: StreamHttpConfig;
	debounce?: StreamDebounceConfig;
}

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

// ─── Provider ─────────────────────────────────────────────────────────────────

export class OpenAIStreamProvider implements StreamProvider {
	private readonly config: OpenAIProviderConfig;

	constructor(config: OpenAIProviderConfig) {
		this.config = config;
	}

	async *stream(messages: OpenAIChat[], signal: AbortSignal): AsyncIterable<StreamContent> {
		const rawStream = this.rawStream(messages, signal);
		yield* debounceStream(rawStream, this.config.debounce);
	}

	private async *rawStream(
		messages: OpenAIChat[],
		signal: AbortSignal
	): AsyncIterable<StreamContent> {
		const response = await this.fetchStream(messages, signal);
		const reader = response.body?.getReader();
		if (!reader) throw new AppError('NETWORK_ERROR', 'Response body is not readable');

		const state: StreamContent = { content: '', thought: '' };
		// Accumulate partial tool call arguments strby index
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

	private async fetchStream(messages: OpenAIChat[], signal: AbortSignal): Promise<Response> {
		const { model, http } = this.config;
		const url = `${http.baseUrl}/chat/completions`;
		const useProxy = http.useProxy ?? true;

		const body = JSON.stringify({
			model: model.modelId,
			messages: messages.map((m) => ({ role: m.role, content: m.content })),
			stream: true,
			...model.parameters
		});

		const response = await appHttp.fetch(
			url,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${http.apiKey}`
				},
				body
			},
			{ proxy: useProxy, signal, retry: http.retry, timeout: http.timeout }
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
			let parsedArgs: Record<string, unknown> = {};
			try {
				parsedArgs = JSON.parse(tc.args);
			} catch {
				// Args still streaming, keep raw string as partial
				parsedArgs = { _raw: tc.args };
			}
			calls.push({ callId: tc.id, name: tc.name, args: parsedArgs });
		}
		return calls;
	}
}
