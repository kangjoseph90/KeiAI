/**
 * Chat Pipeline — KeiAI
 *
 * runChat(chatId) is the single entry point for a full AI response cycle.
 * Messages are persisted to DB immediately on creation.
 * The ChatTask is a thin state tracker — not a content holder.
 */

import {
	createChatTask,
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
	getMergedLorebooks
} from '$lib/stores';
import type { LLMStreamHandler } from '$lib/llm/types';
import { ToolCallService } from '$lib/services/content/tool';
import { MessageService, type Message, type MessageSwipe } from '$lib/services/content/message';
import { updateMessage, createMessage, getMessage } from '$lib/stores/content/message';
import { buildPrompt } from '../llm/prompt/builder';
import { selectLLMHandler } from '../llm/handler';
import { runPipeline } from '../pipeline';
import { createLogger } from '$lib/adapters/logger';
import { AppError } from '$lib/types/errors';
import { deepMerge } from '$lib/utils/defaults';

export interface RunChatOptions {
	/** Optional handler override for testing */
	handlerOverride?: LLMStreamHandler;
	/** If set, this run is a reroll — write to this message's swipes instead of creating a new message */
	reroll?: boolean;
}

const logger = createLogger('task:chat');

// ─── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Run a full AI response cycle for a chat room.
 * Fire-and-forget from the UI — all state is communicated through
 * the runtime task store and message store.
 */
export async function runChat(chatId: string, options?: RunChatOptions): Promise<void> {
	const opts = options ?? {};
	// ── 0. Guard: Prevent duplicate runs ─────────────────────────────
	const existing = getChatTask(chatId);
	if (existing) {
		logger.warn(`Chat ${chatId} is already running.`);
		return;
	}

	const controller = new AbortController();
	try {
		// If not reroll, create new message slot
		if (!opts.reroll) {
			await createMessage(chatId, {
				role: 'char'
			});
		}

		// ── 1. Load all context ──────────────────────────────────────────
		const [chat, settings, lorebooks] = await Promise.all([
			getChatDetail(chatId),
			getAppSettings(),
			getMergedLorebooks(chatId)
		]);

		if (!settings.presetId) throw new AppError('INVALID_INPUT', 'No preset selected');
		if (!settings.personaId) throw new AppError('INVALID_INPUT', 'No persona selected');

		const [character, preset, persona] = await Promise.all([
			getCharacterDetail(chat.characterId),
			getPresetDetail(settings.presetId),
			getPersona(settings.personaId)
		]);

		const messages: Message[] = await MessageService.getMessagesBefore(chatId, '\uffff', 2);
		const targetMessage = messages.length > 0 ? messages[messages.length - 1] : null;
		if (!targetMessage) throw new AppError('INVALID_INPUT', 'No messages found');

		const lastMessage = messages.length > 1 ? messages[messages.length - 2] : null;

		const targetMessageId = targetMessage.id;
		const targetSortOrder = targetMessage.sortOrder;

		// setup variables
		const variables = lastMessage?.swipes[lastMessage.activeSwipeIndex]?.variables ?? {};
		const swipeIndex = settings.chat.saveMessagesOnSwipe
			? targetMessage.swipes.length
			: Math.max(targetMessage.swipes.length - 1, 0);

		targetMessage.swipes[swipeIndex] = {
			content: '',
			variables: deepMerge(chat.data.defaultVariables, variables),
			createdAt: Date.now()
		};
		targetMessage.activeSwipeIndex = swipeIndex;

		await updateMessage(targetMessage.id, targetMessage);

		// ── 3. Register task ──────────────────────────────────────────
		createChatTask(chatId, targetMessageId, controller);

		// ── 5. Build Prompt (pure function) ──────────────────────────────

		// TODO: lazy load messages
		const promptMessages = await MessageService.getMessagesBefore(chatId, targetSortOrder, 1000);

		const prompt = buildPrompt({
			character,
			preset,
			persona,
			lorebooks,
			messages: promptMessages
		});

		// ── 6. Apply Request Scripts ─────────────────────────────────
		const processedMessages = await Promise.all(
			prompt.map(async (msg) => ({
				...msg,
				content: await runPipeline(chatId, 'request', msg.content)
			}))
		);

		// ── 7. Select Handler ──────────────────────────────────────
		const handler = opts.handlerOverride ?? selectLLMHandler(preset.data.chatModel, settings);
		if (!handler) {
			throw new AppError('INVALID_INPUT', 'Failed to create LLM handler. Check API key.');
		}

		// ── 8. Stream chunks → update swipe in DB ─────────────────────
		for await (const state of handler.stream(processedMessages, controller.signal)) {
			const processedContent = await runPipeline(chatId, 'output', state.content);

			const msg = await getMessage(targetMessageId);
			const updatedSwipes = msg.swipes.map((s, i) =>
				i === swipeIndex
					? { ...s, content: processedContent, thought: state.thought ?? s.thought }
					: s
			);
			await updateMessage(targetMessageId, { swipes: updatedSwipes });
		}

		// ── 9. Finalize ─────────────────────────────────────────────
		const finalMsg = await getMessage(targetMessageId);
		const finalSwipe = finalMsg.swipes[swipeIndex];
		if (!finalSwipe || finalSwipe.content.length === 0) {
			setChatTaskError(chatId, 'Empty response from model');
			return;
		}

		clearChatTask(chatId);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			clearChatTask(chatId);
			return;
		}

		const errMsg = error instanceof Error ? error.message : 'Unknown pipeline error';
		setChatTaskError(chatId, errMsg);
	}
}

// ─── Tool Call Resolution ─────────────────────────────────────────────────────

/**
 * Resolve a tool call (approve or reject) and resume the chat if all
 * tool calls in the message are settled.
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

	// 2. Reflect the status change in the active swipe's toolCalls
	const message = await getMessage(messageId);
	if (!message) return;

	const activeSwipe = message.swipes[message.activeSwipeIndex];
	if (!activeSwipe?.toolCalls) return;

	const updatedToolCalls = activeSwipe.toolCalls.map((tc) =>
		tc.id === toolCallId
			? { ...tc, status: isApprove ? ('success' as const) : ('rejected' as const) }
			: tc
	);

	const updatedSwipes = message.swipes.map((s, i) =>
		i === message.activeSwipeIndex ? { ...s, toolCalls: updatedToolCalls } : s
	);
	await updateMessage(messageId, { swipes: updatedSwipes });

	// 3. If all tool calls are settled, resume the pipeline
	const hasPending = updatedToolCalls.some((tc) => tc.status === 'pending');
	if (hasPending) return;

	// Resume with tool execution result
	await runChat(chatId);
}

// ─── Controls ─────────────────────────────────────────────────────────────────

/** Abort the in-flight stream for a chat. */
export function stopChat(chatId: string): void {
	const task = getChatTask(chatId);
	task?.controller.abort();
}

/** Dismiss an error state — clears the task. */
export function dismissChat(chatId: string): void {
	clearChatTask(chatId);
}
