import { get } from 'svelte/store';
import { recordAudioTasks } from '../state';
import type { CreateTaskMetadata, RecordAudioTask } from '../types';
import { showTaskSystemNotification } from './notification';

const COMPLETE_TITLE = 'Audio attached';
const COMPLETE_DESCRIPTION = 'Your recording was added to the chat draft.';
const ERROR_TITLE = 'Audio recording failed';

export function createRecordAudioTask(
    chatId: string,
    taskId: string,
    metadata: CreateTaskMetadata
): void {
    recordAudioTasks.update((tasks) => {
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

function mutateRecordAudioTask(
    chatId: string,
    taskId: string,
    update: (task: RecordAudioTask) => RecordAudioTask
): boolean {
    let updated = false;
    recordAudioTasks.update((tasks) => {
        const task = tasks.get(chatId);
        if (task?.id !== taskId) return tasks;
        const next = new Map(tasks);
        next.set(chatId, update(task));
        updated = true;
        return next;
    });
    return updated;
}

export function setRecordAudioTaskLevels(
    chatId: string,
    taskId: string,
    levels: number[]
): boolean {
    return mutateRecordAudioTask(chatId, taskId, (task) => ({ ...task, levels }));
}

export function setRecordAudioTaskSaving(chatId: string, taskId: string): boolean {
    return mutateRecordAudioTask(chatId, taskId, (task) => ({ ...task, phase: 'saving' }));
}

export function setRecordAudioTaskComplete(chatId: string, taskId: string): boolean {
    return mutateRecordAudioTask(chatId, taskId, (task) => ({
        ...task,
        status: 'completed',
        errorMessage: undefined,
        finishedAt: Date.now()
    }));
}

export function setRecordAudioTaskError(
    chatId: string,
    taskId: string,
    errorMessage: string
): boolean {
    return mutateRecordAudioTask(chatId, taskId, (task) => ({
        ...task,
        phase: 'error',
        status: 'error',
        errorMessage,
        finishedAt: Date.now()
    }));
}

export function notifyRecordAudioTaskComplete(_chatId: string): void {
    void showTaskSystemNotification(COMPLETE_TITLE, COMPLETE_DESCRIPTION);
}

export function notifyRecordAudioTaskError(_chatId: string, errorMessage: string): void {
    void showTaskSystemNotification(ERROR_TITLE, errorMessage);
}

export function clearRecordAudioTask(chatId: string, taskId?: string): void {
    recordAudioTasks.update((tasks) => {
        const task = tasks.get(chatId);
        if (!task || (taskId && task.id !== taskId)) return tasks;
        const next = new Map(tasks);
        next.delete(chatId);
        return next;
    });
}

export function getRecordAudioTask(chatId: string): RecordAudioTask | null {
    return get(recordAudioTasks).get(chatId) ?? null;
}
