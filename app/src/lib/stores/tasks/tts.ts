import { get } from 'svelte/store';
import type { MediaTask } from '../types';
import { ttsTasks } from '../state';

export function createTTSTask(messageId: string, controller: AbortController): void {
    ttsTasks.update((tasks) => {
        const next = new Map(tasks);
        next.set(messageId, { status: 'generating', controller });
        return next;
    });
}

export function setTTSTaskError(messageId: string, errorMessage: string): void {
    ttsTasks.update((tasks) => {
        const task = tasks.get(messageId);
        if (!task) return tasks;
        const next = new Map(tasks);
        next.set(messageId, { ...task, status: 'error', errorMessage });
        return next;
    });
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
