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
    getMergedLorebooks,
    getRoom
} from '$lib/stores';
import type { LLMStreamHandler } from '$lib/llm/types';
import { ToolCallService } from '$lib/services/content/tool';
import { PagedMessages } from '$lib/services/content/paged_messages';
import {
    getMessage,
    createMessage,
    updateMessage,
    updateMessageSwipe,
    getLastMessage
} from '$lib/stores/content/message';
import { getChatVariablesBefore, prepareNextSwipe } from '$lib/managers';
import { buildPrompt } from './prompt';
import { selectLLMHandler } from '../../llm/handler';
import { runPipeline } from '../../pipeline';
import { runTemplate } from '../../template';
import type { TemplateContext } from '../../template';
import { toMessageContext } from './context';
import { createLogger } from '$lib/adapters/logger';
import { AppError } from '$lib/types/errors';

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
export async function runChat(
    chatId: string,
    characterId: string,
    personaId: string,
    opts: RunChatOptions = {}
): Promise<void> {
    // ── 0. Guard: Prevent duplicate runs ─────────────────────────────
    const existing = getChatTask(chatId);
    if (existing) {
        logger.warn(`Chat ${chatId} is already running.`);
        return;
    }

    const controller = new AbortController();
    try {
        // ── 1. Load all context ──────────────────────────────────────────
        const [chat, settings] = await Promise.all([getChat(chatId), getAppSettings()]);

        if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);
        if (!settings.presetId) throw new AppError('INVALID_INPUT', 'No preset selected');

        const room = await getRoom(chat.roomId);
        if (!room) throw new AppError('NOT_FOUND', `Room not found: ${chat.roomId}`);

        const characterRef = room.characters.refs[characterId];
        if (!characterRef || characterRef.enabled === false) {
            throw new AppError('INVALID_INPUT', `Character is not available: ${characterId}`);
        }

        const personaRef = chat.personas.refs[personaId];
        if (!personaRef || personaRef.enabled === false) {
            throw new AppError('INVALID_INPUT', `Persona is not available: ${personaId}`);
        }

        const targetMessage = opts.reroll
            ? await getLastMessage(chatId)
            : await createMessage(chatId, {
                  role: 'assistant'
              });
        if (!targetMessage) throw new AppError('INVALID_INPUT', 'Chat has no messages');
        const messages = await PagedMessages.createBefore(chatId, targetMessage.sortOrder);

        const [character, preset, persona, lorebooks] = await Promise.all([
            getCharacter(characterId),
            getPreset(settings.presetId),
            getPersona(personaId),
            getMergedLorebooks(chatId, characterId)
        ]);

        if (!character) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);
        if (!preset) throw new AppError('NOT_FOUND', `Preset not found: ${settings.presetId}`);
        if (!persona) throw new AppError('NOT_FOUND', `Persona not found: ${personaId}`);

        // ── 2. Setup variables ────────────────────────────────────
        const variables = await getChatVariablesBefore(chatId, targetMessage.sortOrder);
        const shouldReplaceActiveSwipe =
            !settings.chat.saveMessagesOnSwipe &&
            Boolean(targetMessage.swipes[targetMessage.activeSwipeId]);

        const { swipeId: targetSwipeId, message: preparedMessage } = await prepareNextSwipe(
            targetMessage,
            {
                content: '',
                variables,
                speakerId: character.id,
                speakerName: character.name,
                replaceActiveSwipe: shouldReplaceActiveSwipe
            }
        );

        // ── 3. Register task ──────────────────────────────────────────
        createChatTask(chatId, preparedMessage.id, controller);

        // ── 4. Build Prompt (pure function) ──────────────────────────────
        const templateCtx: TemplateContext = {
            characterId,
            personaId: persona.id,
            chatId
        };

        const prompt = await buildPrompt({
            character,
            chat,
            preset,
            persona,
            lorebooks,
            messages,
            tokenizer: preset.chatModel.tokenizer ?? 'o200k_base',
            context: templateCtx
        });

        // ── 4.5. Run Prompt Pipeline ───────────────────────────────────
        const pipedPrompt = await runPipeline(chatId, 'prompt', prompt, templateCtx);

        // ── 5. Select Handler ──────────────────────────────────────
        const handler = opts.handlerOverride ?? selectLLMHandler(preset.chatModel, settings);
        if (!handler) {
            throw new AppError('INVALID_INPUT', 'Failed to create LLM handler. Check API key.');
        }

        // ── 6. Stream chunks → update swipe in DB ─────────────────────
        let finalContent = '';

        for await (const state of handler.stream(pipedPrompt, controller.signal)) {
            finalContent = state.content;

            await updateMessageSwipe(preparedMessage.id, targetSwipeId, {
                content: finalContent,
                ...(state.thought !== undefined ? { thought: state.thought } : {})
            });
        }

        // ── 6.5. Post-process (Output Pipeline & Side-effects) ────────────
        if (finalContent.length > 0) {
            const outputCtx = toMessageContext(preparedMessage, messages.length, templateCtx);
            const templated = await runTemplate(finalContent, outputCtx);
            const piped = await runPipeline(chatId, 'output', templated, outputCtx);
            const processedContent = await runTemplate(piped, outputCtx);

            await updateMessageSwipe(preparedMessage.id, targetSwipeId, {
                content: processedContent
            });
        }

        // ── 7. Finalize ─────────────────────────────────────────────
        const finalMsg = await getMessage(preparedMessage.id);
        if (!finalMsg) {
            setChatTaskError(chatId, 'Message not found after generation');
            return;
        }
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
    characterId: string,
    personaId: string,
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
    await runChat(chatId, characterId, personaId);
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
