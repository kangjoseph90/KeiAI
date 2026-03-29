/**
 * Chat Pipeline — KeiAI
 *
 * runChat(chatId) is the single entry point for a full AI response cycle.
 * All context is loaded at the top as plain data — no wrapper classes.
 *
 */

import {
	createChatTask,
	updateChatTask,
	setChatTaskError,
	getChatTask,
	clearChatTask
} from '$lib/stores/tasks/chat';
import {
	getChatDetail,
	getCharacterDetail,
	getAppSettings,
	getPersona,
	getPresetDetail,
	getMergedLorebooks,
	getMergedScripts
} from '$lib/stores';
import type { LLMStreamProvider } from '$lib/llm/types';
import { ToolCallService } from '$lib/services/content/tool';
import { MessageService, type Message } from '$lib/services/content/message';
import { updateMessage, createMessage, getMessage } from '$lib/stores/content/message';
import { buildPrompt } from '../llm/prompt/builder';
import { selectLLMProvider } from '../llm/provider';
import { applyScripts } from '../scripts';
import { createLogger } from '$lib/adapters/logger';
import { AppError } from '$lib/types/errors';

export interface RunChatOptions {
	/** Save partial content to DB when the user aborts. Default: true */
	saveOnAbort?: boolean;
	/** Optional provider override for testing */
	providerOverride?: LLMStreamProvider;
}

const defaultOptions: RunChatOptions = {
	saveOnAbort: true
};
const logger = createLogger('task:chat');

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
		logger.warn(`Chat ${chatId} is already running.`);
		return;
	}

	const controller = new AbortController();
	activeControllers.set(chatId, controller);

	try {
		// ── 1. Register task + open streaming bubble ────────────────────
		createChatTask(chatId);

		// ── 2. Load all context as plain data ─────────────────────────
		const chat = await getChatDetail(chatId);
		const [character, settings, lorebooks, scripts] = await Promise.all([
			getCharacterDetail(chat.characterId),
			getAppSettings(),
			getMergedLorebooks(chatId),
			getMergedScripts(chatId)
		]);

		if (!settings.presetId) throw new AppError('INVALID_INPUT', 'No preset selected');
		const preset = await getPresetDetail(settings.presetId);

		if (!settings.personaId) throw new AppError('INVALID_INPUT', 'No persona selected');
		const persona = await getPersona(settings.personaId);

		// Load messages for history
		const messages: Message[] = await MessageService.getMessagesAfter(chatId, '');

		// ── 3. Build Prompt (pure function) ──────────────────────────
		const prompt = buildPrompt({ character, preset, persona, lorebooks, messages });

		// ── 4. Apply Request Scripts ─────────────────────────────────
		const processedMessages = await Promise.all(
			prompt.map(async (msg) => ({
				...msg,
				content: await applyScripts(msg.content, scripts, 'request')
			}))
		);

		// ── 5. Select Provider ──────────────────────────────────────
		const provider = opts.providerOverride ?? selectLLMProvider(preset.data.chatModel, settings);

		// ── 6. Stream chunks ────────────────────────────────────────
		for await (const state of provider.stream(processedMessages, controller.signal)) {
			const processedState = {
				...state,
				content: await applyScripts(state.content, scripts, 'output')
			};
			updateChatTask(chatId, processedState);
		}

		// ── 7. Finalize ─────────────────────────────────────────────
		const finalTask = getChatTask(chatId);
		if (!finalTask || (finalTask.content.length === 0 && !finalTask.toolCalls?.length)) {
			throw new AppError('NETWORK_ERROR', 'Empty response from model');
		}

		await persistTask(chatId);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			const task = getChatTask(chatId);
			if (opts.saveOnAbort && task && task.content.length > 0) {
				await persistTask(chatId);
			} else {
				clearChatTask(chatId);
			}
			return;
		}

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
async function persistTask(chatId: string): Promise<void> {
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

	// 2. Reflect the status change in the message (store cache → IDB fallback)
	const message = await getMessage(messageId);
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
