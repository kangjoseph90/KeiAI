import { sha256 } from '$lib/crypto';
import { AppError, getErrorMessage } from '$lib/types/errors';
import type { Macro } from '$lib/template';
import {
    resolveTranslationPair,
    type LanguageCode,
    type ResolvedLanguagePair
} from '$lib/language';
import type { RuntimeContext } from '$lib/types/context';
import { PagedMessages } from '$lib/services/content/paged_messages';
import { getAppSettings } from '$lib/stores/content/settings';
import { getChat } from '$lib/stores/content/chat';
import { getMessage, updateMessageSwipe } from '$lib/stores/content/message';
import {
    clearTranslationTask,
    createTranslationTask,
    getTranslationTask,
    notifyTranslationTaskComplete,
    notifyTranslationTaskError,
    setTranslationTaskComplete,
    setTranslationTaskError
} from '$lib/stores/tasks/translation';
import { WorkflowRuntime } from '$lib/workflow';
import { deserializeAgentParts, getLastTextContent } from '$lib/workflow/agent/llm';
import { toMessageContext } from '$lib/workflow/agent/context';

export interface RunTranslationOptions {
    force?: boolean;
}

export async function createTranslationSourceHash(
    source: string,
    sourceLanguage: string,
    targetLanguage: string
): Promise<string> {
    return sha256(`${sourceLanguage}\0${targetLanguage}\0${source}`);
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

    const source = getLastTextContent(activeSwipe.parts);
    if (!source.trim()) throw new AppError('INVALID_INPUT', 'Translation source is empty');

    const pair: ResolvedLanguagePair = resolveTranslationPair(source, settings.translation);

    const sourceHash = await createTranslationSourceHash(source, pair.source, pair.target);
    if (
        !options.force &&
        activeSwipe.translation?.sourceHash === sourceHash &&
        activeSwipe.translation.text
    ) {
        return;
    }

    const chat = await getChat(message.chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${message.chatId}`);

    const messages = await PagedMessages.createThrough(message);
    const baseCtx: RuntimeContext = {
        roomId: chat.roomId,
        presetId: settings.presetId,
        chatId: chat.id
    };
    const ctx = toMessageContext(message, messages.length - 1, baseCtx);
    const controller = new AbortController();
    const localMacros = createTranslationMacros(source, pair.source, pair.target);
    const swipeId = activeSwipe.id;
    await updateMessageSwipe(message.id, swipeId, {
        translation: { sourceHash, text: '' }
    });

    createTranslationTask(messageId, sourceHash, controller, {
        roomId: chat.roomId,
        chatId: chat.id,
        chatTitle: chat.title,
        title: 'Translation'
    });

    try {
        const runtime = new WorkflowRuntime(settings.translation.workflow, {
            ctx,
            localMacros,
            messages,
            signal: controller.signal
        });

        let finalContent = '';
        for await (const output of runtime.run()) {
            finalContent = getLastTextContent(deserializeAgentParts(output));
            if (!(await saveTranslationText(message.id, swipeId, sourceHash, finalContent))) {
                throw new AppError('INVALID_INPUT', 'Translation source changed');
            }
        }

        if (!finalContent.trim()) {
            throw new AppError('INVALID_INPUT', 'Translation workflow returned empty output');
        }

        setTranslationTaskComplete(messageId);
        notifyTranslationTaskComplete(messageId);
    } catch (error) {
        if (controller.signal.aborted) {
            clearTranslationTask(messageId);
        } else {
            const errorMessage = getErrorMessage(error, 'Translation failed');
            setTranslationTaskError(messageId, errorMessage);
            notifyTranslationTaskError(messageId, errorMessage);
        }
    }
}

async function saveTranslationText(
    messageId: string,
    swipeId: string,
    sourceHash: string,
    text: string
): Promise<boolean> {
    const message = await getMessage(messageId);
    const swipe = message?.swipes[swipeId];
    if (swipe?.translation?.sourceHash !== sourceHash) return false;

    await updateMessageSwipe(messageId, swipeId, {
        translation: { sourceHash, text }
    });
    return true;
}

export function stopTranslation(messageId: string): void {
    const task = getTranslationTask(messageId);
    task?.controller?.abort();
}

export function dismissTranslation(messageId: string): void {
    clearTranslationTask(messageId);
}

function createTranslationMacros(
    source: string,
    sourceLanguage: LanguageCode,
    targetLanguage: LanguageCode
): Map<string, Macro> {
    return new Map([
        ['source', createValueMacro('source', source)],
        ['sourcelang', createValueMacro('sourcelang', sourceLanguage)],
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
