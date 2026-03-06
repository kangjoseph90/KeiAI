/**
 * Chat Pipeline — KeiAI
 *
 * runChat(chatId, provider) is the single entry point for a full AI
 * response cycle. It only knows the chatId — all context loading,
 * prompt building, and EventBus pipes are wired here (or TODO'd here).
 *
 * Current state:
 *   ✅ Streaming lifecycle (startTask → chunks → finalize)
 *   ✅ Abort handling (user Stop → optional partial save)
 *   ✅ Error surfacing (setTaskError → UI bubble stays for dismiss)
 *   🔲 TODO: buildContext(chatId)
 *   🔲 TODO: PromptBuilder
 *   🔲 TODO: pipe:request  (EventBus)
 *   🔲 TODO: pipe:output   (EventBus, applied per-chunk on accumulated raw)
 *   🔲 TODO: gen:* events  (EventBus emit)
 *
 * Rendering note:
 *   pipe:output lives here (content transform before DB save).
 *   pipe:display lives in the Message component (raw content → HTML,
 *   markdown parsing, display regex scripts, then morphdom diff).
 *   The two pipes are intentionally separated — pipe:output is
 *   permanent (stored), pipe:display is ephemeral (render-only).
 */

import {
	startTask,
	setTaskContent,
	setTaskError,
	clearTask,
	getTask,
	stopGeneration
} from '../stores/generation.js';
import { createMessage } from '../stores/message.js';

import type { StreamProvider } from '../llm/types.js';


export interface RunChatOptions {
	/** Save partial content to DB when the user aborts. Default: true */
	saveOnAbort?: boolean;
}

const defaultOptions: Required<RunChatOptions> = {
	saveOnAbort: true
};

// ─── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Run a full AI response cycle for a chat room.
 * Fire-and-forget from the UI — all state is communicated through
 * the generation store (generationTasks) and message store.
 */
export async function runChat(
	chatId: string,
	provider: StreamProvider,
	options?: RunChatOptions
): Promise<void> {
	const opts = { ...defaultOptions, ...options };

	// ── TODO: buildContext ────────────────────────────────────────────
	// const ctx = await buildContext(chatId);
	// Collects: character, chat, activePreset, lorebooks, scripts, persona

	// ── TODO: PromptBuilder ───────────────────────────────────────────
	// let prompt = PromptBuilder.build(ctx);

	// ── TODO: pipe:request ───────────────────────────────────────────
	// Transforms the assembled request payload before LLM call.
	// prompt = await eventBus.pipe('pipe:request', prompt);

	// ── 1. Open ephemeral streaming bubble in UI ──────────────────────
	const controller = startTask(chatId);
	let rawContent = '';

	// ── 2. Stream chunks ──────────────────────────────────────────────
	try {
		for await (const chunk of provider.stream(controller.signal)) {
			rawContent += chunk;

			// ── TODO: pipe:output ─────────────────────────────────────
			// Applied to the *accumulated* raw content on every chunk so
			// the user sees transformed content in real-time during streaming.
			// Variable substitution, persistent regex replacements, etc.
			// const processedContent = await eventBus.pipe('pipe:output', rawContent);
			const processedContent = rawContent; // mock: identity pass-through

			setTaskContent(chatId, processedContent);

			// ── TODO: eventBus.emit('gen:chunk', { chatId, chunk }); ──
		}
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			// User clicked Stop — save what we have (if saveOnAbort)
			const partial = getTask(chatId)?.content ?? '';
			if (opts.saveOnAbort && partial.length > 0) {
				await finalize(chatId, partial);
			} else {
				clearTask(chatId);
			}
			return;
		}

		// Network / API error — surface to UI, don't persist
		const msg = error instanceof Error ? error.message : 'Unknown generation error';
		setTaskError(chatId, msg);
		return;
	}

	// ── 3. Empty response ─────────────────────────────────────────────
	if (rawContent.length === 0) {
		setTaskError(chatId, 'Empty response from model');
		return;
	}

	// ── 4. Finalize ───────────────────────────────────────────────────
	// Use the pipe:output-processed content stored in the task (not raw).
	const finalContent = getTask(chatId)?.content ?? rawContent;
	await finalize(chatId, finalContent);

	// ── TODO: eventBus.emit('gen:completed', { chatId }); ────────────
}

// ─── Controls ─────────────────────────────────────────────────────────────────

/** Abort the in-flight stream for a chat */
export function stop(chatId: string): void {
	stopGeneration(chatId);
}

/** Dismiss an error state — removes the virtual bubble */
export function dismiss(chatId: string): void {
	clearTask(chatId);
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/**
 * Persist content to DB, then clear the virtual streaming bubble.
 * Always persists first, then clears — prevents visual gap between
 * the ephemeral bubble disappearing and the confirmed message appearing.
 */
async function finalize(chatId: string, content: string): Promise<void> {
	try {
		await createMessage(chatId, { role: 'char', content });
		clearTask(chatId);
	} catch (error) {
		const msg = error instanceof Error ? error.message : 'Failed to save message';
		setTaskError(chatId, msg);
	}
}
