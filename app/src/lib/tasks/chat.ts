/**
 * Chat task — thin orchestration around the preset chat workflow.
 *
 * The task owns chat-specific side effects:
 * - message/swipe preparation
 * - task state
 * - streaming workflow output into the target swipe
 * - final output pipeline
 */

import {
    createChatTask,
    setChatTaskError,
    getChatTask,
    clearChatTask,
    notifyChatTaskComplete,
    notifyChatTaskError
} from '$lib/stores/tasks/chat';
import { getChat, getCharacter, getAppSettings, getPersona, getPreset, getRoom } from '$lib/stores';
import { PagedMessages } from '$lib/services/content/paged_messages';
import {
    getMessage,
    createMessage,
    updateMessageSwipe,
    getLastMessage
} from '$lib/stores/content/message';
import { getChatVariablesBefore, prepareNextSwipe } from '$lib/managers';
import { runPipeline } from '$lib/pipeline';
import { runTemplate } from '$lib/template';
import { toMessageContext } from '$lib/workflow/agent/context';
import {
    deserializeAgentParts,
    findLastTextIndex,
    getLastTextContent,
    hasVisibleAgentOutput,
    type AgentPart
} from '$lib/workflow/agent/llm';
import { WorkflowRuntime } from '$lib/workflow';
import { createLogger } from '$lib/adapters/logger';
import { AppError } from '$lib/types/errors';
import type { RuntimeContext } from '$lib/types/context';
import { emitEvent } from '$lib/events';

export interface RunChatOptions {
    /** If set, this run is a reroll — write to this message's swipes instead of creating a new message */
    reroll?: boolean;
}

const logger = createLogger('task:chat');

export async function runChat(
    chatId: string,
    characterId: string,
    personaId: string,
    opts: RunChatOptions = {}
): Promise<void> {
    const existing = getChatTask(chatId);
    if (existing) {
        logger.warn(`Chat ${chatId} is already running.`);
        return;
    }

    const controller = new AbortController();

    try {
        const [chat, settings] = await Promise.all([getChat(chatId), getAppSettings()]);

        if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);
        if (!settings.presetId) throw new AppError('INVALID_INPUT', 'No preset selected');

        const room = await getRoom(chat.roomId);
        if (!room) throw new AppError('NOT_FOUND', `Room not found: ${chat.roomId}`);

        const characterRef = room.characters.refs[characterId];
        if (!characterRef) {
            throw new AppError('INVALID_INPUT', `Character is not available: ${characterId}`);
        }

        const personaRef = chat.personas.refs[personaId];
        if (!personaRef) {
            throw new AppError('INVALID_INPUT', `Persona is not available: ${personaId}`);
        }

        const targetMessage = opts.reroll
            ? await getLastMessage(chatId)
            : await createMessage(chatId, {
                  role: 'assistant'
              });
        if (!targetMessage) throw new AppError('INVALID_INPUT', 'Chat has no messages');

        const messages = await PagedMessages.createBefore(chatId, targetMessage.sortOrder);
        const [character, preset, persona] = await Promise.all([
            getCharacter(characterId),
            getPreset(settings.presetId),
            getPersona(personaId)
        ]);

        if (!character) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);
        if (!preset) throw new AppError('NOT_FOUND', `Preset not found: ${settings.presetId}`);
        if (!persona) throw new AppError('NOT_FOUND', `Persona not found: ${personaId}`);

        const variables = await getChatVariablesBefore(chatId, targetMessage.sortOrder);
        const shouldReplaceActiveSwipe =
            !settings.chat.saveMessagesOnSwipe &&
            Boolean(targetMessage.swipes[targetMessage.activeSwipeId]);

        const { swipeId: targetSwipeId, message: preparedMessage } = await prepareNextSwipe(
            targetMessage,
            {
                parts: [],
                variables,
                speakerId: character.id,
                speakerName: character.name,
                replaceActiveSwipe: shouldReplaceActiveSwipe
            }
        );

        createChatTask(chatId, preparedMessage.id, controller);

        const ctx: RuntimeContext = {
            roomId: chat.roomId,
            presetId: settings.presetId,
            characterId,
            personaId: persona.id,
            chatId
        };

        const runtime = new WorkflowRuntime(preset.chatWorkflow, {
            ctx,
            messages,
            signal: controller.signal
        });

        let finalParts: AgentPart[] = [];
        for await (const output of runtime.run()) {
            finalParts = deserializeAgentParts(output);
            await updateMessageSwipe(preparedMessage.id, targetSwipeId, { parts: finalParts });
        }

        if (getLastTextContent(finalParts).length > 0) {
            const outputCtx = toMessageContext(preparedMessage, messages.length, ctx);
            const lastTextIdx = findLastTextIndex(finalParts);
            if (lastTextIdx >= 0) {
                const lastText = finalParts[lastTextIdx];
                if (lastText.type === 'text') {
                    const templated = await runTemplate(lastText.text, outputCtx);
                    const piped = await runPipeline('output', outputCtx, templated);
                    const processed = await runTemplate(piped, outputCtx);
                    finalParts[lastTextIdx] = { type: 'text', text: processed };
                    await updateMessageSwipe(preparedMessage.id, targetSwipeId, {
                        parts: finalParts
                    });
                }
            }
        }

        const finalMsg = await getMessage(preparedMessage.id);
        if (!finalMsg) {
            const errMsg = 'Message not found after generation';
            setChatTaskError(chatId, errMsg);
            notifyChatTaskError(chatId, errMsg);
            return;
        }
        const finalSwipe = finalMsg.swipes[targetSwipeId];
        if (!finalSwipe || !hasVisibleAgentOutput(finalSwipe.parts)) {
            const errMsg = 'Empty response from model';
            setChatTaskError(chatId, errMsg);
            notifyChatTaskError(chatId, errMsg);
            return;
        }

        void emitEvent('message:received', toMessageContext(finalMsg, messages.length, ctx), {
            content: getLastTextContent(finalSwipe.parts)
        });

        clearChatTask(chatId);
        notifyChatTaskComplete(chatId);
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            clearChatTask(chatId);
            return;
        }

        const errMsg = error instanceof Error ? error.message : 'Unknown pipeline error';
        // setChatTaskError no-ops without a registered task (validation errors), so also log.
        logger.error(`Chat ${chatId} failed: ${errMsg}`);
        setChatTaskError(chatId, errMsg);
        notifyChatTaskError(chatId, errMsg);
    }
}

export function stopChat(chatId: string): void {
    const task = getChatTask(chatId);
    task?.controller.abort();
}

export function dismissChat(chatId: string): void {
    clearChatTask(chatId);
}
