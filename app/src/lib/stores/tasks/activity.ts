import {
    chatTasks,
    dictationTasks,
    imageGenerationTasks,
    inputTranslationTasks,
    suggestionTasks,
    titleTasks,
    translationTasks,
    ttsTasks
} from '../state';
import type { Writable } from 'svelte/store';
import type { ChatTaskIndicator, CollectedTask, TaskMetadata, TaskStatus } from '../types';

export function consumeCompletedTasks(chatId: string): void {
    consumeCompleted(chatTasks, chatId);
    consumeCompleted(translationTasks, chatId);
    consumeCompleted(imageGenerationTasks, chatId);
    consumeCompleted(ttsTasks, chatId);
    consumeCompleted(inputTranslationTasks, chatId);
    consumeCompleted(suggestionTasks, chatId);
    consumeCompleted(titleTasks, chatId);
    consumeCompleted(dictationTasks, chatId);
}

function consumeCompleted<T extends TaskMetadata & { status: TaskStatus }>(
    store: Writable<Map<string, T>>,
    chatId: string
): void {
    store.update((tasks) => {
        const next = new Map(tasks);
        let changed = false;
        for (const [key, task] of tasks) {
            if (task.chatId === chatId && task.status === 'completed') {
                next.delete(key);
                changed = true;
            }
        }
        return changed ? next : tasks;
    });
}

export function getChatTaskIndicator(
    tasks: Iterable<CollectedTask>,
    chatId: string
): ChatTaskIndicator | null {
    let indicator: ChatTaskIndicator | null = null;
    for (const task of tasks) {
        if (task.chatId !== chatId) continue;
        if (task.status === 'error') return 'error';
        if (task.status === 'running') indicator = 'running';
        else if (!indicator) indicator = 'completed';
    }
    return indicator;
}
