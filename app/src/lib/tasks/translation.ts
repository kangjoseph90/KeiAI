import { sha256 } from '$lib/crypto';
import { AppError, getErrorMessage } from '$lib/types/errors';
import type { Macro } from '$lib/template';
import type { RuntimeContext } from '$lib/types/context';
import { PagedMessages } from '$lib/services/content/paged_messages';
import { getAppSettings } from '$lib/stores/content/settings';
import { getChat } from '$lib/stores/content/chat';
import { getMessage } from '$lib/stores/content/message';
import {
    createTranslation,
    findLoadedTranslation,
    updateTranslation
} from '$lib/stores/content/translation';
import {
    clearTranslationTask,
    createTranslationTask,
    getTranslationTask,
    setTranslationTaskError
} from '$lib/stores/tasks/translation';
import { WorkflowRuntime } from '$lib/workflow';
import { deserializeAgentParts, getLastContentText } from '$lib/workflow/agent/llm';
import { toMessageContext } from '$lib/workflow/agent/context';

export interface RunTranslationOptions {
    force?: boolean;
}

export async function createTranslationSourceHash(
    source: string,
    targetLanguage: string
): Promise<string> {
    return sha256(`${targetLanguage}\0${source}`);
}

export async function runTranslation(
    messageId: string,
    options: RunTranslationOptions = {}
): Promise<void> {
    const running = getTranslationTask(messageId);
    if (running?.status === 'generating') {
        throw new AppError('INVALID_INPUT', `Translation is already running: ${messageId}`);
    }

    const [settings, message] = await Promise.all([getAppSettings(), getMessage(messageId)]);
    if (!message) throw new AppError('NOT_FOUND', `Message not found: ${messageId}`);
    if (!settings.presetId) throw new AppError('INVALID_INPUT', 'No preset selected');

    const activeSwipe = message.swipes[message.activeSwipeId];
    if (!activeSwipe) throw new AppError('INVALID_INPUT', 'Message has no active swipe');

    const source = getLastContentText(activeSwipe.parts);
    if (!source.trim()) throw new AppError('INVALID_INPUT', 'Translation source is empty');

    const targetLanguage = settings.translation.targetLanguage.trim();
    if (!targetLanguage) throw new AppError('INVALID_INPUT', 'Target language is required');

    const sourceHash = await createTranslationSourceHash(source, targetLanguage);
    const existing = findLoadedTranslation(messageId, sourceHash);
    if (existing && !options.force) return;

    const chat = await getChat(message.chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${message.chatId}`);

    const messages = await PagedMessages.createBefore(message.chatId, message.sortOrder);
    const baseCtx: RuntimeContext = {
        roomId: chat.roomId,
        presetId: settings.presetId,
        chatId: chat.id
    };
    const ctx = toMessageContext(message, messages.length, baseCtx);
    const controller = new AbortController();
    const localMacros = createTranslationMacros(source, targetLanguage);
    const translation = existing
        ? existing
        : await createTranslation(message.chatId, message.id, {
              sourceHash,
              text: ''
          });

    if (existing) {
        await updateTranslation(existing.id, { text: '' });
    }

    createTranslationTask(messageId, sourceHash, controller);

    try {
        const runtime = new WorkflowRuntime(settings.translation.workflow, {
            ctx,
            localMacros,
            messages,
            signal: controller.signal
        });

        let finalContent = '';
        for await (const output of runtime.run()) {
            finalContent = getLastContentText(deserializeAgentParts(output));
            await updateTranslation(translation.id, { text: finalContent });
        }

        if (!finalContent.trim()) {
            throw new AppError('INVALID_INPUT', 'Translation workflow returned empty output');
        }

        clearTranslationTask(messageId);
    } catch (error) {
        if (controller.signal.aborted) {
            clearTranslationTask(messageId);
        } else {
            setTranslationTaskError(messageId, getErrorMessage(error, 'Translation failed'));
        }
        throw error;
    }
}

export function stopTranslation(messageId: string): void {
    const task = getTranslationTask(messageId);
    task?.controller.abort();
}

export function dismissTranslation(messageId: string): void {
    clearTranslationTask(messageId);
}

function createTranslationMacros(source: string, targetLanguage: string): Map<string, Macro> {
    return new Map([
        ['source', createValueMacro('source', source)],
        ['targetlang', createValueMacro('targetlang', targetLanguage)]
    ]);
}

function createValueMacro(name: string, value: string): Macro {
    return {
        recursive: false,
        run: (args) => {
            if (args.length !== 0) {
                throw new AppError('INVALID_INPUT', `{{${name}}} does not accept arguments`);
            }
            return value;
        }
    };
}
