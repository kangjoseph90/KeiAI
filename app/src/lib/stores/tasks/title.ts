import { get } from 'svelte/store';
import { titleTasks } from '../state';
import type { CreateTaskMetadata, TitleTask } from '../types';
import { showTaskSystemNotification } from './notification';

const COMPLETE_TITLE = 'Title generated';
const COMPLETE_DESCRIPTION = 'A chat title has been generated.';
const ERROR_TITLE = 'Title generation failed';

export function createTitleTask(
    chatId: string,
    controller: AbortController,
    metadata: CreateTaskMetadata
): void {
    titleTasks.update((tasks) => {
        const next = new Map(tasks);
        next.set(chatId, {
            ...metadata,
            status: 'generating',
            controller,
            startedAt: Date.now()
        });
        return next;
    });
}

export function setTitleTaskError(chatId: string, errorMessage: string): void {
    titleTasks.update((tasks) => {
        const task = tasks.get(chatId);
        if (!task) return tasks;
        const next = new Map(tasks);
        next.set(chatId, {
            ...task,
            status: 'error',
            controller: undefined,
            errorMessage,
            finishedAt: Date.now()
        });
        return next;
    });
}

export function setTitleTaskComplete(chatId: string): void {
    titleTasks.update((tasks) => {
        const task = tasks.get(chatId);
        if (!task) return tasks;
        const next = new Map(tasks);
        next.set(chatId, {
            ...task,
            status: 'completed',
            controller: undefined,
            errorMessage: undefined,
            finishedAt: Date.now()
        });
        return next;
    });
}

export function notifyTitleTaskComplete(_chatId: string): void {
    void showTaskSystemNotification(COMPLETE_TITLE, COMPLETE_DESCRIPTION);
}

export function notifyTitleTaskError(_chatId: string, errorMessage: string): void {
    void showTaskSystemNotification(ERROR_TITLE, errorMessage);
}

export function clearTitleTask(chatId: string): void {
    titleTasks.update((tasks) => {
        if (!tasks.has(chatId)) return tasks;
        const next = new Map(tasks);
        next.delete(chatId);
        return next;
    });
}

export function getTitleTask(chatId: string): TitleTask | null {
    return get(titleTasks).get(chatId) ?? null;
}

export function getGeneratingTitleTaskIds(chatId: string): string[] {
    return Array.from(get(titleTasks).entries())
        .filter(([, task]) => task.chatId === chatId && task.status === 'generating')
        .map(([id]) => id);
}
