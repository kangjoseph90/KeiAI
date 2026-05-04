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
    getChat,
    getCharacter,
    getAppSettings,
    getPersona,
    getPreset,
    getMergedLorebooks
} from '$lib/stores';
import type { LLMStreamHandler } from '$lib/llm/types';
import { ToolCallService } from '$lib/services/content/tool';
import { clock } from '$lib/utils/clock';
import type { MessageSwipe } from '$lib/services/content/message';
import { PagedMessages } from '$lib/services/content/paged_messages';
import {
    createMessage,
    getLastMessage,
    getMessage,
    prepareNextSwipe,
    updateMessage
} from '$lib/stores/content/message';
import { buildPrompt } from '../llm/prompt/builder';
import { selectLLMHandler } from '../llm/handler';
import { runPipeline } from '../pipeline';
import { createLogger } from '$lib/adapters/logger';
import { AppError } from '$lib/types/errors';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';

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
        // ── 1. Load all context ──────────────────────────────────────────
        const [chat, settings, lorebooks] = await Promise.all([
            getChat(chatId),
            getAppSettings(),
            getMergedLorebooks(chatId)
        ]);

        if (!settings.presetId) throw new AppError('INVALID_INPUT', 'No preset selected');
        if (!settings.personaId) throw new AppError('INVALID_INPUT', 'No persona selected');

        const targetMessage = opts.reroll
            ? await getLastMessage(chatId)
            : await createMessage(chatId, {
                  role: 'char'
              });
        if (!targetMessage) throw new AppError('INVALID_INPUT', 'Chat has no messages');
        const messages = await PagedMessages.createBefore(chatId, targetMessage.sortOrder);

        const [character, preset, persona] = await Promise.all([
            getCharacter(chat.characterId),
            getPreset(settings.presetId),
            getPersona(settings.personaId)
        ]);

        // ── 2. Load Prompt History ────────────────────────────────────
        const lastMessage = await messages.at(-1);

        // setup variables
        const variables = lastMessage?.swipes[lastMessage.activeSwipeId]?.variables ?? {};
        const shouldReplaceActiveSwipe =
            !settings.chat.saveMessagesOnSwipe &&
            Boolean(targetMessage.swipes[targetMessage.activeSwipeId]);

        const nextSwipeFields = {
            content: '',
            variables: deepMerge(chat.defaultVariables, variables),
            createdAt: clock.now()
        };

        const { swipeId: targetSwipeId, message: preparedMessage } = await prepareNextSwipe(
            targetMessage,
            nextSwipeFields,
            shouldReplaceActiveSwipe
        );

        // ── 3. Register task ──────────────────────────────────────────
        createChatTask(chatId, preparedMessage.id, controller);

        // ── 4. Build Prompt (pure function) ──────────────────────────────

        const prompt = await buildPrompt({
            character,
            preset,
            persona,
            lorebooks,
            messages
        });

        // ── 5. Apply Request Scripts ─────────────────────────────────
        const processedMessages = await Promise.all(
            prompt.map(async (msg, index) => ({
                ...msg,
                content: await runPipeline(chatId, 'request', msg.content, {
                    role: msg.role
                })
            }))
        );

        // ── 6. Select Handler ──────────────────────────────────────
        const handler = opts.handlerOverride ?? selectLLMHandler(preset.chatModel, settings);
        if (!handler) {
            throw new AppError('INVALID_INPUT', 'Failed to create LLM handler. Check API key.');
        }

        // ── 7. Stream chunks → update swipe in DB ─────────────────────
        for await (const state of handler.stream(processedMessages, controller.signal)) {
            const processedContent = await runPipeline(chatId, 'output', state.content, {
                messageId: preparedMessage.id
            });

            const swipeUpdate: Record<string, DeepPartial<MessageSwipe>> = {
                [targetSwipeId]: { content: processedContent }
            };
            if (state.thought !== undefined) {
                swipeUpdate[targetSwipeId].thought = state.thought;
            }
            await updateMessage(preparedMessage.id, { swipes: swipeUpdate });
        }

        // ── 8. Finalize ─────────────────────────────────────────────
        const finalMsg = await getMessage(preparedMessage.id);
        const finalSwipe = finalMsg.swipes[targetSwipeId];
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

    const activeSwipe = message.swipes[message.activeSwipeId];
    if (!activeSwipe?.toolCalls?.[toolCallId]) return;

    const updatedStatus = isApprove ? ('success' as const) : ('rejected' as const);
    const hasOtherPending = Object.entries(activeSwipe.toolCalls).some(
        ([id, tc]) => id !== toolCallId && tc.status === 'pending'
    );

    await updateMessage(messageId, {
        swipes: {
            [message.activeSwipeId]: { toolCalls: { [toolCallId]: { status: updatedStatus } } }
        }
    });

    // 3. If all tool calls are settled, resume the pipeline
    if (hasOtherPending) return;

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
