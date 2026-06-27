import { get } from 'svelte/store';
import { translationTasks } from '../state';
import type { TranslationTask } from '../types';

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
