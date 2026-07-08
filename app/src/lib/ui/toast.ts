import { generateId } from '$lib/utils/id';
import { toastItems, type ToastAction, type ToastItem, type ToastKind } from './state';

export interface ToastOptions {
    kind?: ToastKind;
    title: string;
    description?: string;
    action?: ToastAction;
    durationMs?: number;
    persistent?: boolean;
}

const DEFAULT_DURATION_MS = 4000;

export function dismissToast(id: string): void {
    toastItems.update((items) => items.filter((item) => item.id !== id));
}

export function showToast(options: ToastOptions): string {
    const id = generateId();
    const persistent = options.persistent ?? options.durationMs === 0;
    const item: ToastItem = {
        id,
        kind: options.kind ?? 'info',
        title: options.title,
        description: options.description,
        action: options.action,
        persistent
    };

    toastItems.update((items) => [...items, item]);

    if (!persistent) {
        setTimeout(() => dismissToast(id), options.durationMs ?? DEFAULT_DURATION_MS);
    }

    return id;
}

export const toast = {
    info: (options: Omit<ToastOptions, 'kind'>) => showToast({ ...options, kind: 'info' }),
    success: (options: Omit<ToastOptions, 'kind'>) => showToast({ ...options, kind: 'success' }),
    warning: (options: Omit<ToastOptions, 'kind'>) => showToast({ ...options, kind: 'warning' }),
    error: (options: Omit<ToastOptions, 'kind'>) => showToast({ ...options, kind: 'error' })
};
