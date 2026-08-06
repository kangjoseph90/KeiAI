import { get } from 'svelte/store';
import { translationTasks } from '../state';
import type { CreateTaskMetadata, TranslationTask } from '../types';
import { showTaskSystemNotification } from './notification';

const TRANSLATION_COMPLETE_TITLE = 'Translation ready';
const TRANSLATION_COMPLETE_DESCRIPTION = 'A translation has finished generating.';
const TRANSLATION_ERROR_TITLE = 'Translation failed';

export function createTranslationTask(
    messageId: string,
    sourceHash: string,
    controller: AbortController,
    metadata: CreateTaskMetadata
): void {
    translationTasks.update((tasks) => {
        const next = new Map(tasks);
        next.set(messageId, {
            ...metadata,
            status: 'generating',
            sourceHash,
            controller,
            startedAt: Date.now()
        });
        return next;
    });
}

export function setTranslationTaskError(messageId: string, errorMessage: string): void {
    translationTasks.update((tasks) => {
        const task = tasks.get(messageId);
        if (!task) return tasks;
        const next = new Map(tasks);
        next.set(messageId, {
            ...task,
            status: 'error',
            controller: undefined,
            errorMessage,
            finishedAt: Date.now()
        });
        return next;
    });
}

export function setTranslationTaskComplete(messageId: string): void {
    translationTasks.update((tasks) => {
        const task = tasks.get(messageId);
        if (!task) return tasks;
        const next = new Map(tasks);
        next.set(messageId, {
            ...task,
            status: 'completed',
            controller: undefined,
            errorMessage: undefined,
            finishedAt: Date.now()
        });
        return next;
    });
}

export function notifyTranslationTaskComplete(_messageId: string): void {
    void showTaskSystemNotification(TRANSLATION_COMPLETE_TITLE, TRANSLATION_COMPLETE_DESCRIPTION);
}

export function notifyTranslationTaskError(_messageId: string, errorMessage: string): void {
    void showTaskSystemNotification(TRANSLATION_ERROR_TITLE, errorMessage);
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
