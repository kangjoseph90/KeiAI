import { AppError, getErrorMessage } from '$lib/types/errors';
import type { Macro } from '$lib/template';
import type { RuntimeContext } from '$lib/types/context';
import { PagedMessages } from '$lib/services/content/paged_messages';
import { getAppSettings } from '$lib/stores/content/settings';
import { getChat } from '$lib/stores/content/chat';
import { getLastMessage } from '$lib/stores/content/message';
import {
    dismissChatDraftSuggestion,
    getChatDraft,
    setChatDraftSuggestion
} from '$lib/stores/content/draft';
import {
    clearSuggestionTask,
    createSuggestionTask,
    getGeneratingSuggestionTaskIds,
    getSuggestionTask,
    notifySuggestionTaskComplete,
    notifySuggestionTaskError,
    setSuggestionTaskComplete,
    setSuggestionTaskError
} from '$lib/stores/tasks/suggestion';
import { WorkflowRuntime } from '$lib/workflow';
import { deserializeAgentParts, getLastTextContent } from '$lib/workflow/agent/llm';
import { generateId } from '$lib/utils/id';

export async function runSuggestion(chatId: string): Promise<void> {
    const [settings, chat] = await Promise.all([getAppSettings(), getChat(chatId)]);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);
    if (!settings.presetId) throw new AppError('INVALID_INPUT', 'No preset selected');

    const source = getChatDraft(chatId).text;
    const suggestionId = generateId();

    const lastMessage = await getLastMessage(chatId);
    const messages = lastMessage
        ? await PagedMessages.createThrough(lastMessage)
        : await PagedMessages.createBefore(chatId, '\uffff');

    const ctx: RuntimeContext = {
        roomId: chat.roomId,
        presetId: settings.presetId,
        chatId: chat.id
    };
    const localMacros = createSuggestionMacros(source);

    setChatDraftSuggestion(chatId, suggestionId, '');
    const controller = new AbortController();
    createSuggestionTask(suggestionId, controller, {
        roomId: chat.roomId,
        chatId: chat.id,
        chatTitle: chat.title,
        title: 'Suggestion'
    });

    try {
        const runtime = new WorkflowRuntime(settings.suggestion.workflow, {
            ctx,
            localMacros,
            messages,
            signal: controller.signal
        });

        let finalContent = '';
        for await (const output of runtime.run()) {
            finalContent = getLastTextContent(deserializeAgentParts(output));
            setChatDraftSuggestion(chatId, suggestionId, finalContent);
        }

        setSuggestionTaskComplete(suggestionId);
        notifySuggestionTaskComplete(suggestionId);
    } catch (error) {
        if (controller.signal.aborted) {
            clearSuggestionTask(suggestionId);
            const draft = getChatDraft(chatId);
            if (!draft.suggestions[suggestionId]?.trim()) {
                dismissChatDraftSuggestion(chatId, suggestionId);
            }
        } else {
            const errorMessage = getErrorMessage(error, 'Suggestion failed');
            setSuggestionTaskError(suggestionId, errorMessage);
            notifySuggestionTaskError(suggestionId, errorMessage);
        }
    }
}

export function stopSuggestion(suggestionId: string): void {
    getSuggestionTask(suggestionId)?.controller?.abort();
}

export function stopSuggestionForChat(chatId: string): void {
    for (const suggestionId of getGeneratingSuggestionTaskIds(chatId)) {
        getSuggestionTask(suggestionId)?.controller?.abort();
    }
}

export function dismissSuggestion(suggestionId: string): void {
    clearSuggestionTask(suggestionId);
}

function createSuggestionMacros(source: string): Map<string, Macro> {
    return new Map([['source', createValueMacro('source', source)]]);
}

function createValueMacro(name: string, value: string): Macro {
    return {
        recursive: false,
        run: (args) => {
            if (args.length !== 0) {
                throw new AppError('INVALID_INPUT', `{{${name}}} does not accept arguments`);
            }
            return value;
        }
    };
}
