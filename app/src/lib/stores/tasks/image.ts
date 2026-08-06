import { get } from 'svelte/store';
import type { CreateTaskMetadata, MediaTask } from '../types';
import { imageGenerationTasks } from '../state';
import { showTaskSystemNotification } from './notification';

const IMAGE_COMPLETE_TITLE = 'Image ready';
const IMAGE_COMPLETE_DESCRIPTION = 'An image has finished generating.';
const IMAGE_ERROR_TITLE = 'Image generation failed';

export function createImageGenerationTask(
    messageId: string,
    controller: AbortController,
    metadata: CreateTaskMetadata
): void {
    imageGenerationTasks.update((tasks) => {
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

export function setImageGenerationTaskError(messageId: string, errorMessage: string): void {
    imageGenerationTasks.update((tasks) => {
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

export function setImageGenerationTaskComplete(messageId: string): void {
    imageGenerationTasks.update((tasks) => {
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

export function notifyImageGenerationTaskComplete(_messageId: string): void {
    void showTaskSystemNotification(IMAGE_COMPLETE_TITLE, IMAGE_COMPLETE_DESCRIPTION);
}

export function notifyImageGenerationTaskError(_messageId: string, errorMessage: string): void {
    void showTaskSystemNotification(IMAGE_ERROR_TITLE, errorMessage);
}

export function clearImageGenerationTask(messageId: string): void {
    imageGenerationTasks.update((tasks) => {
        if (!tasks.has(messageId)) return tasks;
        const next = new Map(tasks);
        next.delete(messageId);
        return next;
    });
}

export function getImageGenerationTask(messageId: string): MediaTask | null {
    return get(imageGenerationTasks).get(messageId) ?? null;
}
