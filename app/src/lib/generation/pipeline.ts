/**
 * Chat Pipeline — KeiAI
 *
 * runChat(chatId, provider) is the single entry point for a full AI
 * response cycle. It only knows the chatId — all context is loaded
 * directly from the Service Layer (DB) at call time.
 *
 * Design: Stateless pipeline.
 *   - Does NOT read from Svelte stores (stores are UI cache only).
 *   - Snapshots all needed data (character, lorebooks, scripts, preset)
 *     from Service Layer at the start of each run. This ensures background
 *     generations are isolated from UI context switches.
 *   - Only writes to the generation store (ephemeral, chatId-keyed).
 *
 * Current state:
 *   ✅ Streaming lifecycle (startTask → chunks → finalize)
 *   ✅ Abort handling (user Stop → optional partial save)
 *   ✅ Error surfacing (setTaskError → UI bubble stays for dismiss)
 *   🔲 TODO: buildContext(chatId) — snapshot from services
 *   🔲 TODO: PromptBuilder
 *   🔲 TODO: runScripts (output transform, applied per-chunk)
 *
 * Rendering note:
 *   Output scripts run here (content transform before DB save).
 *   Display scripts run in the Message component (raw content → HTML,
 *   markdown parsing, display regex, then morphdom diff).
 *   The two are intentionally separated — output is permanent (stored),
 *   display is ephemeral (render-only).
 */

import {
	startTask,
	setTaskContent,
	setTaskError,
	clearTask,
	getTask,
	stopGeneration
} from '../stores/generation.js';
import { createMessage } from '../stores/content/message.js';

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

	// ── 1. Open ephemeral streaming bubble in UI ──────────────────────
	const controller = startTask(chatId);
	let rawContent = '';

	// ── 2. Stream chunks ──────────────────────────────────────────────
	try {
		for await (const chunk of provider.stream(controller.signal)) {
			rawContent += chunk;

			// ── TODO: runScripts (output transform) ───────────────────
			// Apply ctx.scripts with placement 'output' to accumulated
			// raw content. Runs on every chunk so the user sees
			// transformed content in real-time during streaming.
			// const processedContent = runScripts(ctx.scripts, 'output', rawContent);
			const processedContent = rawContent; // pass-through until scripts are wired

			setTaskContent(chatId, processedContent);
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
	const finalContent = getTask(chatId)?.content ?? rawContent;
	await finalize(chatId, finalContent);
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

