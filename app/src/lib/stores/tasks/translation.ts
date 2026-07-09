import { get } from 'svelte/store';
import { activeChatId, translationTasks } from '../state';
import { MessageService } from '$lib/services';
import type { TranslationTask } from '../types';
import { isDocumentVisible, showTaskNotificationOrToast } from './notification';

const TRANSLATION_COMPLETE_TITLE = 'Translation ready';
const TRANSLATION_COMPLETE_DESCRIPTION = 'A translation has finished generating.';
const TRANSLATION_ERROR_TITLE = 'Translation failed';

async function getMessageChatId(messageId: string): Promise<string | null> {
    try {
        const message = await MessageService.get(messageId);
        return message?.chatId ?? null;
    } catch {
        return null;
    }
}

export function createTranslationTask(
    messageId: string,
    sourceHash: string,
    controller: AbortController
): void {
    translationTasks.update((tasks) => {
        const next = new Map(tasks);
        next.set(messageId, {
            status: 'generating',
            sourceHash,
            controller
        });
        return next;
    });
}

export function setTranslationTaskError(messageId: string, errorMessage: string): void {
    translationTasks.update((tasks) => {
        const task = tasks.get(messageId);
        if (!task) return tasks;
        const next = new Map(tasks);
        next.set(messageId, { ...task, status: 'error', errorMessage });
        return next;
    });
}

export function notifyTranslationTaskComplete(messageId: string): void {
    void (async () => {
        const chatId = await getMessageChatId(messageId);
        if (chatId && get(activeChatId) === chatId && isDocumentVisible()) return;

        await showTaskNotificationOrToast(
            'success',
            TRANSLATION_COMPLETE_TITLE,
            TRANSLATION_COMPLETE_DESCRIPTION
        );
    })();
}

export function notifyTranslationTaskError(_messageId: string, errorMessage: string): void {
    void showTaskNotificationOrToast('error', TRANSLATION_ERROR_TITLE, errorMessage);
}

export function clearTranslationTask(messageId: string): void {
    translationTasks.update((tasks) => {
        if (!tasks.has(messageId)) return tasks;
        const next = new Map(tasks);
        next.delete(messageId);
        return next;
    });
}

export function getTranslationTask(messageId: string): TranslationTask | null {
    return get(translationTasks).get(messageId) ?? null;
}
