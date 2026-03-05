/**
 * Generation Manager — LLM Response Orchestration
 *
 * Coordinates the full lifecycle of an AI response:
 *   1. Start a generation task (ephemeral UI state)
 *   2. Stream chunks from the LLM provider
 *   3. On completion: persist to DB via existing stores/message.ts
 *   4. On error: surface to UI via generation store
 *   5. On abort: optionally save partial content
 *
 * This layer ONLY orchestrates. It does NOT:
 *   - Call crypto directly (MessageService handles E2EE)
 *   - Manage store writables (generation.ts and message.ts do that)
 *   - Build prompts (future PromptBuilder responsibility)
 *   - Know about specific LLM APIs (StreamProvider abstraction)
 *
 * Usage:
 *   import { GenerationManager } from '$lib/generation/manager';
 *   GenerationManager.generate(chatId, streamProvider);
 */

import {
	startTask,
	appendChunk,
	setTaskError,
	clearTask,
	getTask,
	stopGeneration
} from '../stores/generation.js';
import { createMessage } from '../stores/message.js';

// ─── Stream Provider Interface ──────────────────────────────────────

/**
 * Abstract interface for any LLM streaming source.
 * Implementations will live in a future `lib/adapters/llm/` layer.
 *
 * Contract:
 *   - Yield string chunks as they arrive
 *   - Respect the AbortSignal for cancellation
 *   - Throw on unrecoverable errors (network, auth, etc.)
 */
export interface StreamProvider {
	stream(signal: AbortSignal): AsyncIterable<string>;
}

// ─── Generation Options ─────────────────────────────────────────────

export interface GenerationOptions {
	/** Save partial content to DB if the user aborts mid-stream. Default: true */
	saveOnAbort?: boolean;
}

const defaultOptions: Required<GenerationOptions> = {
	saveOnAbort: true
};

// ─── Manager ────────────────────────────────────────────────────────

export class GenerationManager {
	/**
	 * Run a full generation lifecycle for a chat.
	 *
	 * Fire-and-forget from the UI's perspective — all state transitions
	 * are communicated through the generation and message stores.
	 */
	static async generate(
		chatId: string,
		provider: StreamProvider,
		options?: GenerationOptions
	): Promise<void> {
		const opts = { ...defaultOptions, ...options };

		// 1. Start ephemeral task → UI shows empty AI bubble
		const controller = startTask(chatId);

		// 2. Stream
		try {
			for await (const chunk of provider.stream(controller.signal)) {
				appendChunk(chatId, chunk);
			}
		} catch (error: unknown) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				// User clicked stop — handle gracefully
				const task = getTask(chatId);
				const partialContent = task?.content ?? '';

				if (opts.saveOnAbort && partialContent.length > 0) {
					// Save what we have so far
					await this.finalize(chatId, partialContent);
				} else {
					clearTask(chatId);
				}
				return;
			}

			// Actual error — show in UI, don't save
			const message = error instanceof Error ? error.message : 'Unknown generation error';
			setTaskError(chatId, message);
			return;
		}

		// 3. Streaming completed successfully — finalize
		const task = getTask(chatId);
		const finalContent = task?.content ?? '';

		if (finalContent.length === 0) {
			// Empty response — treat as error
			setTaskError(chatId, 'Empty response from model');
			return;
		}

		await this.finalize(chatId, finalContent);
	}

	/**
	 * Persist content to DB and swap the virtual bubble for a confirmed message.
	 *
	 * Flow:
	 *   createMessage() → MessageService.create() (encrypts + writes DB)
	 *                   → messages store update (if still in this chat)
	 *   clearTask()     → removes the virtual generating bubble
	 *
	 * The order matters: create first, then clear.
	 * This ensures there's no visual gap where neither the virtual nor
	 * the confirmed message is visible.
	 */
	private static async finalize(chatId: string, content: string): Promise<void> {
		try {
			await createMessage(chatId, { role: 'char', content });
			clearTask(chatId);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to save message';
			setTaskError(chatId, message);
		}
	}

	/** Convenience: abort a running generation */
	static stop(chatId: string): void {
		stopGeneration(chatId);
	}

	/** Convenience: dismiss an error state */
	static dismiss(chatId: string): void {
		clearTask(chatId);
	}
}
