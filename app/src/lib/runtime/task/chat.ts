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
	createChatTask,
	updateChatTask,
	setChatTaskError,
	getChatTask,
	clearChatTask,
	consumeChatTask
} from '$lib/stores/task/chat';
import type { ChatTask } from '$lib/stores/types';
import type { StreamProvider } from '$lib/llm/types';
import { ToolCallService } from '$lib/services/content/tool';
import { updateMessage } from '$lib/stores/content/message';
import { createMessage } from '$lib/stores/content/message';
import { MessageService } from '$lib/services/content/message';
import { MockStreamProvider } from '$lib/llm/mock';

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
	createChatTask(chatId);

	// ── 2. Stream chunks ───────────────────────────────────────────────
	try {
		for await (const state of provider.stream(controller.signal)) {
			// ── TODO: runScripts (output transform) ───────────────────
			// Apply ctx.scripts with placement 'output' to accumulated
			// raw content. Runs on every chunk so the user sees
			// transformed content in real-time during streaming.
			// const processedContent = runScripts(ctx.scripts, 'output', state.content);

			// For now, we update the task state directly with structured data
			updateChatTask(chatId, state);
		}
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			// User clicked Stop — save partial content if opted in
			const task = getChatTask(chatId);
			if (opts.saveOnAbort && task && task.content.length > 0) {
				await _persistTask(chatId);
			} else {
				clearChatTask(chatId);
			}
			return;
		}

		// Network / API error — surface to UI, don't persist
		const msg = error instanceof Error ? error.message : 'Unknown generation error';
		setChatTaskError(chatId, msg);
		return;
	} finally {
		activeControllers.delete(chatId);
	}

	// ── 3. Finalize ────────────────────────────────────────────────────
	const finalTask = getChatTask(chatId);
	if (!finalTask || (finalTask.content.length === 0 && !finalTask.toolCalls?.length)) {
		setChatTaskError(chatId, 'Empty response from model');
		return;
	}

	await _persistTask(chatId);
}

// ─── Persist ──────────────────────────────────────────────────────────────────

/**
 * Consume the ephemeral task from the store and write it to the DB.
 * Called exclusively from the runtime layer — never from stores or UI.
 */
async function _persistTask(chatId: string): Promise<void> {
	const task = consumeChatTask(chatId);
	if (!task) return;

	try {
		// 1. Create Tool Calls in DB, collect abstract references
		const toolCallAbstracts = await Promise.all(
			(task.toolCalls ?? []).map(async (tc) => {
				const created = await ToolCallService.create(chatId, {
					call: { callId: tc.callId ?? '', name: tc.name, args: tc.args ?? {} }
				});
				return { id: created.id, name: created.call.name, status: 'pending' as const };
			})
		);

		// 2. Create Message in DB (store update handled inside createMessage)
		await createMessage(chatId, {
			role: 'char',
			content: task.content,
			thought: task.thought,
			toolCalls: toolCallAbstracts.length > 0 ? toolCallAbstracts : undefined
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : 'Failed to save message';
		setChatTaskError(chatId, msg);
	}
}

// ─── Tool Call Resolution ─────────────────────────────────────────────────────

/**
 * Resolve a tool call (approve or reject) and resume the chat if all
 * tool calls in the message are settled.
 *
 * This is the single entry point for tool interaction — UI calls this,
 * no store or service calls from UI directly.
 */
export async function resolveToolCall(
	chatId: string,
	messageId: string,
	toolCallId: string,
	decision: 'approve' | 'reject'
): Promise<void> {
	const isApprove = decision === 'approve';

	// 1. Update ToolCall record in DB (status + mock response)
	await ToolCallService.update(toolCallId, {
		status: isApprove ? 'success' : 'rejected',
		response: {
			content: [
				{
					type: 'text',
					text: isApprove ? 'Execution result (Mock)' : 'Execution rejected by user'
				}
			],
			isError: !isApprove
		}
	});

	// 2. Reflect the status change in the message (DB + Store sync via updateMessage)
	const message = await MessageService.get(messageId);
	if (!message?.toolCalls) return;

	const updatedToolCalls = message.toolCalls.map((tc) =>
		tc.id === toolCallId
			? { ...tc, status: isApprove ? ('success' as const) : ('rejected' as const) }
			: tc
	);
	await updateMessage(messageId, { toolCalls: updatedToolCalls });

	// 3. If all tool calls are settled, resume the pipeline
	const hasPending = updatedToolCalls.some((tc) => tc.status === 'pending');
	if (hasPending) return;

	// TODO: Get provider from active preset settings instead of Mock
	const provider = new MockStreamProvider(
		isApprove ? 'Resuming...' : 'Resuming after rejection...'
	);
	await runChat(chatId, provider);
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
