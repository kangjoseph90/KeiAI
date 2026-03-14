/**
 * Chat Pipeline — KeiAI
 *
 * runChat(chatId) is the single entry point for a full AI response cycle.
 * It only knows the chatId — all context is loaded directly from the Service Layer.
 *
 * Design: Stateless pipeline with internal provider selection.
 *
 *   - Provider selection based on preset configuration
 *   - Prompt building from context (character, lorebooks, scripts, etc.)
 *   - Script processing (input/request/output/display)
 *   - Support for different models (chat, translation, summarization, etc.)
 *   - Optional provider override for testing
 *
 * Current state:
 *   ✅ Streaming lifecycle (createTask → chunks → finalize)
 *   ✅ Abort handling (user Stop → optional partial save)
 *   ✅ Error surfacing (setChatError → UI bubble stays for dismiss)
 *   ✅ PromptBuilder integration
 *   ✅ Internal provider selection
 *   ✅ Script processing (request + output)
 */

import {
	createChatTask,
	updateChatTask,
	setChatTaskError,
	getChatTask,
	clearChatTask,
	consumeChatTask
} from '$lib/stores/task/chat';
import type { StreamProvider } from '$lib/llm/types';
import type { OpenAIChat } from '$lib/runtime/prompt/types';
import { ToolCallService } from '$lib/services/content/tool';
import { updateMessage } from '$lib/stores/content/message';
import { createMessage } from '$lib/stores/content/message';
import { MessageService } from '$lib/services/content/message';
import { ChatContext } from '../context/chat';
import { buildPrompt } from '../prompt/builder';
import { selectProvider } from './provider';
import { applyScripts } from '../scripts/executor';

export interface RunChatOptions {
	/** Save partial content to DB when the user aborts. Default: true */
	saveOnAbort?: boolean;
	/** Optional provider override for testing */
	providerOverride?: StreamProvider;
}

const defaultOptions: RunChatOptions = {
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
export async function runChat(chatId: string, options?: RunChatOptions): Promise<void> {
	const opts = { ...defaultOptions, ...options };

	// ── 0. Guard: Prevent duplicate runs ─────────────────────────────
	if (activeControllers.has(chatId)) {
		console.warn(`Chat ${chatId} is already running.`);
		return;
	}

	const controller = new AbortController();
	activeControllers.set(chatId, controller);

	try {
		// ── 1. Register task + open streaming bubble ────────────────────
		createChatTask(chatId);

		// ── 2. Build Context ───────────────────────────────────────────
		const ctx = new ChatContext(chatId);

		// ── 3. Build Prompt ────────────────────────────────────────────
		const messages: OpenAIChat[] = await buildPrompt(ctx);

		// ── 4. Get Scripts ─────────────────────────────────────────────
		const scripts = await ctx.getScripts();

		// ── 5. Apply Request Scripts ──────────────────────────────────
		const processedMessages = await Promise.all(
			messages.map(async (msg) => ({
				...msg,
				content: await applyScripts(msg.content, scripts, 'request')
			}))
		);

		// ── 6. Select Provider ─────────────────────────────────────────
		const provider = opts.providerOverride ?? (await selectProvider(ctx));

		// ── 7. Stream chunks ─────────────────────────────────────────
		for await (const state of provider.stream(processedMessages, controller.signal)) {
			// Apply output scripts to each chunk
			const processedState = {
				...state,
				content: await applyScripts(state.content, scripts, 'output')
			};
			updateChatTask(chatId, processedState);
		}

		// ── 8. Finalize ───────────────────────────────────────────────
		const finalTask = getChatTask(chatId);
		if (!finalTask || (finalTask.content.length === 0 && !finalTask.toolCalls?.length)) {
			throw new Error('Empty response from model');
		}

		await _persistTask(chatId);
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

		// Surface all other errors to UI
		const msg = error instanceof Error ? error.message : 'Unknown pipeline error';
		setChatTaskError(chatId, msg);
	} finally {
		activeControllers.delete(chatId);
	}
}

// ─── Persist ──────────────────────────────────────────────────────────────────

/**
 * Consume the ephemeral task from the store and write it to the DB.
 * Called exclusively from the runtime layer — never from stores or UI.
 */
async function _persistTask(chatId: string): Promise<void> {
	const task = getChatTask(chatId);
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

		// 3. ONLY clear the ephemeral task AFTER the real message is in the store
		clearChatTask(chatId);
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

	// Resume with tool execution result
	await runChat(chatId);
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
