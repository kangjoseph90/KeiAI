import { get } from 'svelte/store';
import type { CreateTaskMetadata, MediaTask } from '../types';
import { ttsTasks } from '../state';
import { showTaskSystemNotification } from './notification';

const TTS_COMPLETE_TITLE = 'Speech ready';
const TTS_COMPLETE_DESCRIPTION = 'Speech audio has finished generating.';
const TTS_ERROR_TITLE = 'Speech generation failed';

export function createTTSTask(
    messageId: string,
    controller: AbortController,
    metadata: CreateTaskMetadata
): void {
    ttsTasks.update((tasks) => {
        const next = new Map(tasks);
        next.set(messageId, {
            ...metadata,
            status: 'generating',
            controller,
            startedAt: Date.now()
        });
        return next;
    });
}

export function setTTSTaskError(messageId: string, errorMessage: string): void {
    ttsTasks.update((tasks) => {
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

export function setTTSTaskComplete(messageId: string): void {
    ttsTasks.update((tasks) => {
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

export function notifyTTSTaskComplete(_messageId: string): void {
    void showTaskSystemNotification(TTS_COMPLETE_TITLE, TTS_COMPLETE_DESCRIPTION);
}

export function notifyTTSTaskError(_messageId: string, errorMessage: string): void {
    void showTaskSystemNotification(TTS_ERROR_TITLE, errorMessage);
}

export function clearTTSTask(messageId: string): void {
    ttsTasks.update((tasks) => {
        if (!tasks.has(messageId)) return tasks;
        const next = new Map(tasks);
        next.delete(messageId);
        return next;
    });
}

export function getTTSTask(messageId: string): MediaTask | null {
    return get(ttsTasks).get(messageId) ?? null;
}
