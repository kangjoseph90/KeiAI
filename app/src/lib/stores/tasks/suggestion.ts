import { get } from 'svelte/store';
import { suggestionTasks } from '../state';
import type { CreateTaskMetadata, SuggestionTask } from '../types';
import { showTaskSystemNotification } from './notification';

const COMPLETE_TITLE = 'Suggestion ready';
const COMPLETE_DESCRIPTION = 'A suggestion has finished generating.';
const ERROR_TITLE = 'Suggestion failed';

export function createSuggestionTask(
    suggestionId: string,
    controller: AbortController,
    metadata: CreateTaskMetadata
): void {
    suggestionTasks.update((tasks) => {
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

export function setSuggestionTaskError(suggestionId: string, errorMessage: string): void {
    suggestionTasks.update((tasks) => {
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

export function setSuggestionTaskComplete(suggestionId: string): void {
    suggestionTasks.update((tasks) => {
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

export function notifySuggestionTaskComplete(_suggestionId: string): void {
    void showTaskSystemNotification(COMPLETE_TITLE, COMPLETE_DESCRIPTION);
}

export function notifySuggestionTaskError(_suggestionId: string, errorMessage: string): void {
    void showTaskSystemNotification(ERROR_TITLE, errorMessage);
}

export function clearSuggestionTask(suggestionId: string): void {
    suggestionTasks.update((tasks) => {
        if (!tasks.has(suggestionId)) return tasks;
        const next = new Map(tasks);
        next.delete(suggestionId);
        return next;
    });
}

export function getSuggestionTask(suggestionId: string): SuggestionTask | null {
    return get(suggestionTasks).get(suggestionId) ?? null;
}

export function getGeneratingSuggestionTaskIds(chatId: string): string[] {
    return Array.from(get(suggestionTasks).entries())
        .filter(([, task]) => task.chatId === chatId && task.status === 'generating')
        .map(([id]) => id);
}
