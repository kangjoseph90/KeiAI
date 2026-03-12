/**
 * Chat Pipeline — KeiAI
 *
 * runChat(chatId, provider) is the single entry point for a full AI
 * response cycle. It only knows the chatId — all context is loaded
 * directly from the Service Layer (DB) at call time.
 *
 * Design: Stateless pipeline. AbortController lives here — it controls
 * execution, not display state.
 *
 *   - Does NOT read from Svelte stores (stores are UI cache only).
 *   - Snapshots all needed data (character, lorebooks, scripts, preset)
 *     from Service Layer at the start of each run. This ensures background
 *     generations are isolated from UI context switches.
 *   - Writes to task store via stores/runtime/task.ts (content/status).
 *   - Finalize: read task content → createMessage → clearTask.
 *
 * Current state:
 *   ✅ Streaming lifecycle (createTask({kind: 'chat'}) → chunks → _finalize)
 *   ✅ Abort handling (user Stop → optional partial save)
 *   ✅ Error surfacing (setTaskError → UI bubble stays for dismiss)
 *   🔲 TODO: buildContext(chatId) — snapshot from services
 *   🔲 TODO: PromptBuilder
 *   🔲 TODO: runScripts (output transform, applied per-chunk)
 */

import {
	createTask,
	appendChunk,
	setTaskContent,
	setTaskError,
	getTask,
	clearChatTask,
	clearTask
} from '$lib/stores/runtime/task';
import { createMessage } from '$lib/stores/content/message';
import type { StreamProvider } from '$lib/llm/types';

export interface RunChatOptions {
	/** Save partial content to DB when the user aborts. Default: true */
	saveOnAbort?: boolean;
}

const defaultOptions: Required<RunChatOptions> = {
	saveOnAbort: true
};

// ─── Active Controllers ────────────────────────────────────────────────────────

/**
 * chatId → AbortController for all in-flight chat generations.
 * Lives here (pipeline layer) — execution control is separate from display state.
 * UI calls stopChat(chatId) to abort; this map is the authority.
 */
const activeControllers = new Map<string, AbortController>();

// ─── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Run a full AI response cycle for a chat room.
 * Fire-and-forget from the UI — all state is communicated through
 * the runtime task store and message store.
 */
export async function runChat(
	chatId: string,
	provider: StreamProvider,
	options?: RunChatOptions
): Promise<void> {
	const opts = { ...defaultOptions, ...options };

	// ── TODO: buildContext(chatId) ────────────────────────────────────
	// Snapshot all needed data from Service Layer (NOT from stores).
	// const ctx = await buildContext(chatId);
	//   → CharacterService.getDetail(charId)
	//   → LorebookService.listByOwner(charId)
	//   → ScriptService.listByOwner(charId)
	//   → PresetService.getDetail(presetId)
	// This frozen context is used for the entire run, isolated from
	// UI context switches (user navigating to different characters).

	// ── TODO: PromptBuilder ───────────────────────────────────────────
	// let prompt = PromptBuilder.build(ctx);

	// ── TODO: runScripts (request transform) ──────────────────────────
	// Apply ctx.scripts with placement 'request' to the prompt payload.
	// prompt = runScripts(ctx.scripts, 'request', prompt);

	// ── 1. Register task + open streaming bubble ───────────────────────
	const controller = new AbortController();
	activeControllers.set(chatId, controller);
	const taskId = createTask({ kind: 'chat', chatId });
	let rawContent = '';

	// ── 2. Stream chunks ───────────────────────────────────────────────
	try {
		for await (const chunk of provider.stream(controller.signal)) {
			rawContent += chunk;

			// ── TODO: runScripts (output transform) ───────────────────
			// Apply ctx.scripts with placement 'output' to accumulated
			// raw content. Runs on every chunk so the user sees
			// transformed content in real-time during streaming.
			// const processedContent = runScripts(ctx.scripts, 'output', rawContent);
			const processedContent = rawContent; // pass-through until scripts are wired

			setTaskContent(taskId, processedContent);
		}
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			// User clicked Stop — save partial content if opted in
			const partial = getTask(taskId)?.content ?? '';
			if (opts.saveOnAbort && partial.length > 0) {
				await _finalize(chatId, taskId, partial);
			} else {
				clearTask(taskId);
			}
			return;
		}

		// Network / API error — surface to UI, don't persist
		const msg = error instanceof Error ? error.message : 'Unknown generation error';
		setTaskError(taskId, msg);
		return;
	} finally {
		activeControllers.delete(chatId);
	}

	// ── 3. Empty response ──────────────────────────────────────────────
	if (rawContent.length === 0) {
		setTaskError(taskId, 'Empty response from model');
		return;
	}

	// ── 4. Finalize ────────────────────────────────────────────────────
	const finalContent = getTask(taskId)?.content ?? rawContent;
	await _finalize(chatId, taskId, finalContent);
}

// ─── Controls ─────────────────────────────────────────────────────────────────

/** Abort the in-flight stream for a chat. */
export function stopChat(chatId: string): void {
	activeControllers.get(chatId)?.abort();
}

/** Dismiss an error state — removes the virtual bubble. */
export function dismissChat(chatId: string): void {
	clearChatTask(chatId);
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/**
 * Persist content to DB, then clear the task state.
 */
async function _finalize(chatId: string, taskId: string, content: string): Promise<void> {
	try {
		await createMessage(chatId, { role: 'char', content });
		clearTask(taskId);
	} catch (error) {
		const msg = error instanceof Error ? error.message : 'Failed to save message';
		setTaskError(taskId, msg);
		// Ensure controller is cleaned up even on finalize failure
		activeControllers.delete(chatId);
	}
}
