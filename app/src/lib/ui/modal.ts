import { generateId } from '$lib/utils/id';
import { modalQueue, type ModalRequest, type ModalVariant } from './state';

export interface AlertOptions {
    title: string;
    description?: string;
    confirmText?: string;
}

export interface ConfirmOptions {
    title: string;
    description?: string;
    confirmText?: string;
    cancelText?: string;
    variant?: ModalVariant;
}

export interface PromptOptions {
    title: string;
    description?: string;
    confirmText?: string;
    cancelText?: string;
    defaultValue?: string;
    placeholder?: string;
}

function removeModal(id: string): void {
    modalQueue.update((queue) => queue.filter((request) => request.id !== id));
}

function pushModal(request: ModalRequest): void {
    modalQueue.update((queue) => [...queue, request]);
}

export function resolveModal(request: ModalRequest, value?: string): void {
    removeModal(request.id);
    if (request.type === 'alert') {
        request.resolve();
    } else if (request.type === 'confirm') {
        request.resolve(true);
    } else {
        request.resolve(value ?? '');
    }
}

export function cancelModal(request: ModalRequest): void {
    removeModal(request.id);
    if (request.type === 'alert') {
        request.resolve();
    } else if (request.type === 'confirm') {
        request.resolve(false);
    } else {
        request.resolve(null);
    }
}

export function appAlert(options: AlertOptions): Promise<void> {
    return new Promise((resolve) => {
        pushModal({
            id: generateId(),
            type: 'alert',
            title: options.title,
            description: options.description,
            confirmText: options.confirmText ?? 'OK',
            resolve
        });
    });
}

export function appConfirm(options: ConfirmOptions, signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
        const id = generateId();
        let settled = false;
        const finish = (value: boolean): void => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            resolve(value);
        };
        const onAbort = (): void => {
            removeModal(id);
            finish(false);
        };
        if (signal?.aborted) {
            finish(false);
            return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        pushModal({
            id,
            type: 'confirm',
            title: options.title,
            description: options.description,
            confirmText: options.confirmText ?? 'Confirm',
            cancelText: options.cancelText ?? 'Cancel',
            variant: options.variant ?? 'default',
            resolve: finish
        });
    });
}

export function appPrompt(options: PromptOptions): Promise<string | null> {
    return new Promise((resolve) => {
        pushModal({
            id: generateId(),
            type: 'prompt',
            title: options.title,
            description: options.description,
            confirmText: options.confirmText ?? 'OK',
            cancelText: options.cancelText ?? 'Cancel',
            defaultValue: options.defaultValue ?? '',
            placeholder: options.placeholder,
            resolve
        });
    });
}
