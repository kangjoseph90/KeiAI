import { get } from 'svelte/store';
import type { MediaTask } from '../types';
import { imageGenerationTasks } from '../state';

export function createImageGenerationTask(messageId: string, controller: AbortController): void {
    imageGenerationTasks.update((tasks) => {
        const next = new Map(tasks);
        next.set(messageId, { status: 'generating', controller });
        return next;
    });
}

export function setImageGenerationTaskError(messageId: string, errorMessage: string): void {
    imageGenerationTasks.update((tasks) => {
        const task = tasks.get(messageId);
        if (!task) return tasks;
        const next = new Map(tasks);
        next.set(messageId, { ...task, status: 'error', errorMessage });
        return next;
    });
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
