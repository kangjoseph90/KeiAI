import { get } from 'svelte/store';
import { dictationTasks } from '../state';
import type { CreateTaskMetadata, DictationTask } from '../types';
import { showTaskSystemNotification } from './notification';

const DICTATION_COMPLETE_TITLE = 'Dictation ready';
const DICTATION_COMPLETE_DESCRIPTION = 'Your transcript was added to the chat draft.';
const DICTATION_ERROR_TITLE = 'Dictation failed';

export function createDictationTask(
    chatId: string,
    taskId: string,
    metadata: CreateTaskMetadata
): void {
    dictationTasks.update((tasks) => {
        const next = new Map(tasks);
        next.set(chatId, {
            ...metadata,
            id: taskId,
            chatId,
            status: 'generating',
            phase: 'recording',
            levels: Array(200).fill(0),
            startedAt: Date.now()
        });
        return next;
    });
}

function mutateDictationTask(
    chatId: string,
    taskId: string,
    update: (task: DictationTask) => DictationTask
): boolean {
    let updated = false;
    dictationTasks.update((tasks) => {
        const task = tasks.get(chatId);
        if (task?.id !== taskId) return tasks;
        const next = new Map(tasks);
        next.set(chatId, update(task));
        updated = true;
        return next;
    });
    return updated;
}

export function setDictationTaskLevels(chatId: string, taskId: string, levels: number[]): boolean {
    return mutateDictationTask(chatId, taskId, (task) => ({ ...task, levels }));
}

export function setDictationTaskComplete(chatId: string, taskId: string): boolean {
    return mutateDictationTask(chatId, taskId, (task) => ({
        ...task,
        status: 'completed',
        errorMessage: undefined,
        finishedAt: Date.now()
    }));
}

export function setDictationTaskError(
    chatId: string,
    taskId: string,
    errorMessage: string
): boolean {
    return mutateDictationTask(chatId, taskId, (task) => ({
        ...task,
        phase: 'error',
        status: 'error',
        errorMessage,
        finishedAt: Date.now()
    }));
}

export function setDictationTaskTranscribing(chatId: string, taskId: string): boolean {
    return mutateDictationTask(chatId, taskId, (task) => ({
        ...task,
        phase: 'transcribing'
    }));
}

export function notifyDictationTaskComplete(_chatId: string): void {
    void showTaskSystemNotification(DICTATION_COMPLETE_TITLE, DICTATION_COMPLETE_DESCRIPTION);
}

export function notifyDictationTaskError(_chatId: string, errorMessage: string): void {
    void showTaskSystemNotification(DICTATION_ERROR_TITLE, errorMessage);
}

export function clearDictationTask(chatId: string, taskId?: string): void {
    dictationTasks.update((tasks) => {
        const task = tasks.get(chatId);
        if (!task || (taskId && task.id !== taskId)) return tasks;
        const next = new Map(tasks);
        next.delete(chatId);
        return next;
    });
}

export function getDictationTask(chatId: string): DictationTask | null {
    return get(dictationTasks).get(chatId) ?? null;
}
