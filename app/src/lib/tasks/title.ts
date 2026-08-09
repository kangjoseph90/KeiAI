import { AppError, getErrorMessage } from '$lib/types/errors';
import type { RuntimeContext } from '$lib/types/context';
import { PagedMessages } from '$lib/services/content/paged_messages';
import { getAppSettings } from '$lib/stores/content/settings';
import { getChat, updateChat } from '$lib/stores/content/chat';
import { getLastMessage } from '$lib/stores/content/message';
import {
    clearTitleTask,
    createTitleTask,
    getGeneratingTitleTaskIds,
    getTitleTask,
    notifyTitleTaskComplete,
    notifyTitleTaskError,
    setTitleTaskComplete,
    setTitleTaskError
} from '$lib/stores/tasks/title';
import { WorkflowRuntime } from '$lib/workflow';
import { deserializeAgentParts, getLastTextContent } from '$lib/workflow/agent/llm';

export async function runTitle(chatId: string): Promise<void> {
    const [settings, chat] = await Promise.all([getAppSettings(), getChat(chatId)]);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);
    if (!settings.presetId) throw new AppError('INVALID_INPUT', 'No preset selected');

    const lastMessage = await getLastMessage(chatId);
    if (!lastMessage) throw new AppError('INVALID_INPUT', 'Chat has no messages to summarize');

    const messages = await PagedMessages.createThrough(lastMessage);
    const ctx: RuntimeContext = {
        roomId: chat.roomId,
        presetId: settings.presetId,
        chatId: chat.id
    };

    const controller = new AbortController();
    createTitleTask(chatId, controller, {
        roomId: chat.roomId,
        chatId: chat.id,
        chatTitle: chat.title,
        title: 'Generate title'
    });

    try {
        const runtime = new WorkflowRuntime(settings.titleGeneration.workflow, {
            ctx,
            messages,
            signal: controller.signal
        });

        let finalContent = '';
        for await (const output of runtime.run()) {
            finalContent = getLastTextContent(deserializeAgentParts(output));
        }

        const title = finalContent.trim();
        if (title) {
            await updateChat(chatId, { title });
        }
        setTitleTaskComplete(chatId);
        notifyTitleTaskComplete(chatId);
    } catch (error) {
        if (controller.signal.aborted) {
            clearTitleTask(chatId);
        } else {
            const errorMessage = getErrorMessage(error, 'Title generation failed');
            setTitleTaskError(chatId, errorMessage);
            notifyTitleTaskError(chatId, errorMessage);
        }
    }
}

export function stopTitle(chatId: string): void {
    getTitleTask(chatId)?.controller?.abort();
}

export function stopTitleForChat(chatId: string): void {
    for (const taskId of getGeneratingTitleTaskIds(chatId)) {
        getTitleTask(taskId)?.controller?.abort();
    }
}

export function dismissTitle(chatId: string): void {
    clearTitleTask(chatId);
}
