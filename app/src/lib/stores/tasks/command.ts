import { get } from 'svelte/store';
import { commandTasks } from '../state';
import type { CommandTask, CreateTaskMetadata } from '../types';
import { showTaskSystemNotification } from './notification';

export function createCommandTask(
    commandId: string,
    commandName: string,
    messageId: string | undefined,
    controller: AbortController,
    metadata: CreateTaskMetadata
): void {
    commandTasks.update((tasks) => {
        const next = new Map(tasks);
        next.set(metadata.chatId, {
            ...metadata,
            status: 'generating',
            commandId,
            commandName,
            messageId,
            controller,
            startedAt: Date.now()
        });
        return next;
    });
}

export function setCommandTaskError(chatId: string, errorMessage: string): void {
    mutateCommandTask(chatId, (task) => ({
        ...task,
        status: 'error',
        controller: undefined,
        errorMessage,
        finishedAt: Date.now()
    }));
}

export function setCommandTaskComplete(chatId: string): void {
    mutateCommandTask(chatId, (task) => ({
        ...task,
        status: 'completed',
        controller: undefined,
        errorMessage: undefined,
        finishedAt: Date.now()
    }));
}

export function notifyCommandTaskComplete(commandName: string): void {
    void showTaskSystemNotification(`/${commandName} completed`, 'Command workflow completed.');
}

export function notifyCommandTaskError(commandName: string, errorMessage: string): void {
    void showTaskSystemNotification(`/${commandName} failed`, errorMessage);
}

export function clearCommandTask(chatId: string): void {
    commandTasks.update((tasks) => {
        if (!tasks.has(chatId)) return tasks;
        const next = new Map(tasks);
        next.delete(chatId);
        return next;
    });
}

export function getCommandTask(chatId: string): CommandTask | null {
    return get(commandTasks).get(chatId) ?? null;
}

function mutateCommandTask(chatId: string, update: (task: CommandTask) => CommandTask): void {
    commandTasks.update((tasks) => {
        const task = tasks.get(chatId);
        if (!task) return tasks;
        const next = new Map(tasks);
        next.set(chatId, update(task));
        return next;
    });
}
