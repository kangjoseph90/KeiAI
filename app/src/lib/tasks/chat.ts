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
import { MessageService, type Message, type MessageSwipe } from '$lib/services/content/message';
import { updateMessage, createMessage, getMessage } from '$lib/stores/content/message';
import { buildPrompt } from '../llm/prompt/builder';
import { selectLLMHandler } from '../llm/handler';
import { runPipeline } from '../pipeline';
import { createLogger } from '$lib/adapters/logger';
import { AppError } from '$lib/types/errors';
import { deepMerge } from '$lib/utils/defaults';
import { generateId } from '$lib/utils/id';

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
            getChat(chatId),
            getAppSettings(),
            getMergedLorebooks(chatId)
        ]);

        if (!settings.presetId) throw new AppError('INVALID_INPUT', 'No preset selected');
        if (!settings.personaId) throw new AppError('INVALID_INPUT', 'No persona selected');
        if (!chat.lastMessageId) throw new AppError('INVALID_INPUT', 'Chat has no messages');

        const [character, preset, persona, targetMessage] = await Promise.all([
            getCharacter(chat.characterId),
            getPreset(settings.presetId),
            getPersona(settings.personaId),
            getMessage(chat.lastMessageId)
        ]);

        // ── 2. Load Prompt History ────────────────────────────────────
        // Fetch 1000 messages at once and use the last one for variables
        // TODO: lazy load for prompt builder
        const promptMessages = await MessageService.getMessagesBefore(
            chatId,
            targetMessage.sortOrder,
            1000
        );
        const lastMessage = promptMessages[promptMessages.length - 1] || null;

        // setup variables
        const variables = lastMessage?.swipes[lastMessage.activeSwipeId]?.variables ?? {};
        const targetSwipeId = settings.chat.saveMessagesOnSwipe
            ? generateId()
            : targetMessage.activeSwipeId;

        targetMessage.swipes[targetSwipeId] = {
            id: targetSwipeId,
            content: '',
            variables: deepMerge(chat.defaultVariables, variables),
            createdAt: clock.now()
        };
        targetMessage.activeSwipeId = targetSwipeId;

        await updateMessage(targetMessage.id, targetMessage);

        // ── 3. Register task ──────────────────────────────────────────
        createChatTask(chatId, targetMessage.id, controller);

        // ── 4. Build Prompt (pure function) ──────────────────────────────

        const prompt = buildPrompt({
            character,
            preset,
            persona,
            lorebooks,
            messages: promptMessages
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
                messageId: targetMessage.id
            });

            const swipeUpdate: Record<string, Partial<MessageSwipe>> = {
                [targetSwipeId]: { content: processedContent }
            };
            if (state.thought !== undefined) {
                swipeUpdate[targetSwipeId].thought = state.thought;
            }
            await updateMessage(targetMessage.id, { swipes: swipeUpdate });
        }

        // ── 8. Finalize ─────────────────────────────────────────────
        const finalMsg = await getMessage(targetMessage.id);
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
