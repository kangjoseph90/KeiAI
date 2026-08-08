import { get } from 'svelte/store';
import { inputTranslationTasks } from '../state';
import type { CreateTaskMetadata, InputTranslationTask } from '../types';
import { showTaskSystemNotification } from './notification';

const COMPLETE_TITLE = 'Input translation ready';
const COMPLETE_DESCRIPTION = 'A translation suggestion has finished generating.';
const ERROR_TITLE = 'Input translation failed';

export function createInputTranslationTask(
    suggestionId: string,
    controller: AbortController,
    metadata: CreateTaskMetadata
): void {
    inputTranslationTasks.update((tasks) => {
        const next = new Map(tasks);
        next.set(suggestionId, {
            ...metadata,
            status: 'generating',
            controller,
            startedAt: Date.now()
        });
        return next;
    });
}

export function setInputTranslationTaskError(suggestionId: string, errorMessage: string): void {
    inputTranslationTasks.update((tasks) => {
        const task = tasks.get(suggestionId);
        if (!task) return tasks;
        const next = new Map(tasks);
        next.set(suggestionId, {
            ...task,
            status: 'error',
            controller: undefined,
            errorMessage,
            finishedAt: Date.now()
        });
        return next;
    });
}

export function setInputTranslationTaskComplete(suggestionId: string): void {
    inputTranslationTasks.update((tasks) => {
        const task = tasks.get(suggestionId);
        if (!task) return tasks;
        const next = new Map(tasks);
        next.set(suggestionId, {
            ...task,
            status: 'completed',
            controller: undefined,
            errorMessage: undefined,
            finishedAt: Date.now()
        });
        return next;
    });
}

export function notifyInputTranslationTaskComplete(_suggestionId: string): void {
    void showTaskSystemNotification(COMPLETE_TITLE, COMPLETE_DESCRIPTION);
}

export function notifyInputTranslationTaskError(_suggestionId: string, errorMessage: string): void {
    void showTaskSystemNotification(ERROR_TITLE, errorMessage);
}

export function clearInputTranslationTask(suggestionId: string): void {
    inputTranslationTasks.update((tasks) => {
        if (!tasks.has(suggestionId)) return tasks;
        const next = new Map(tasks);
        next.delete(suggestionId);
        return next;
    });
}

export function getInputTranslationTask(suggestionId: string): InputTranslationTask | null {
    return get(inputTranslationTasks).get(suggestionId) ?? null;
}

export function getGeneratingInputTranslationTaskIds(chatId: string): string[] {
    return Array.from(get(inputTranslationTasks).entries())
        .filter(([, task]) => task.chatId === chatId && task.status === 'generating')
        .map(([id]) => id);
}
