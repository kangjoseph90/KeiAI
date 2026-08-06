import { AppError, getErrorMessage } from '$lib/types/errors';
import type { Macro } from '$lib/template';
import type { RuntimeContext } from '$lib/types/context';
import { getAssetMediaType } from '$lib/types/asset';
import { PagedMessages } from '$lib/services';
import { getAppSettings, getChat, getMessage, updateMessageSwipe } from '$lib/stores';
import { WorkflowRuntime } from '$lib/workflow';
import { deserializeAgentParts, getLastTextContent } from '$lib/workflow/agent/llm';
import { toMessageContext } from '$lib/workflow/agent/context';
import {
    clearTTSTask,
    createTTSTask,
    getTTSTask,
    notifyTTSTaskComplete,
    notifyTTSTaskError,
    setTTSTaskComplete,
    setTTSTaskError
} from '$lib/stores/tasks/tts';

export async function runTTS(messageId: string): Promise<void> {
    if (getTTSTask(messageId)?.status === 'generating') {
        throw new AppError('INVALID_INPUT', `Text to speech is already running: ${messageId}`);
    }

    const [settings, message] = await Promise.all([getAppSettings(), getMessage(messageId)]);
    if (!message) throw new AppError('NOT_FOUND', `Message not found: ${messageId}`);
    const swipe = message.swipes[message.activeSwipeId];
    if (!swipe) throw new AppError('INVALID_INPUT', 'Message has no active swipe');

    const source = getLastTextContent(swipe.parts);
    if (!source.trim()) throw new AppError('INVALID_INPUT', 'Text to speech source is empty');

    const chat = await getChat(message.chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${message.chatId}`);
    const messages = await PagedMessages.createThrough(message);
    const baseCtx: RuntimeContext = {
        roomId: chat.roomId,
        presetId: settings.presetId,
        chatId: chat.id
    };
    const controller = new AbortController();
    createTTSTask(messageId, controller, {
        roomId: chat.roomId,
        chatId: chat.id,
        chatTitle: chat.title,
        title: 'Audio generation'
    });

    try {
        const runtime = new WorkflowRuntime(settings.tts.workflow, {
            ctx: toMessageContext(message, messages.length - 1, baseCtx),
            localMacros: createSourceMacros(source),
            messages,
            signal: controller.signal
        });

        let finalIds: string[] = [];
        for await (const output of runtime.run()) {
            const inlayIds = collectInlayIds(output);
            const currentChat = await getChat(message.chatId);
            if (!currentChat) throw new AppError('NOT_FOUND', `Chat not found: ${message.chatId}`);
            finalIds = inlayIds.filter((id) => {
                const ref = currentChat.inlays.refs[id];
                return ref && getAssetMediaType(ref.mimeType) === 'audio';
            });
            if (finalIds.length > 0) {
                await updateMessageSwipe(message.id, swipe.id, { audioAttachments: finalIds });
            }
        }
        if (finalIds.length === 0) {
            throw new AppError('INVALID_INPUT', 'Text to speech workflow returned no audio');
        }
        setTTSTaskComplete(messageId);
        notifyTTSTaskComplete(messageId);
    } catch (error) {
        if (controller.signal.aborted) {
            clearTTSTask(messageId);
        } else {
            const errorMessage = getErrorMessage(error, 'Text to speech failed');
            setTTSTaskError(messageId, errorMessage);
            notifyTTSTaskError(messageId, errorMessage);
        }
        throw error;
    }
}

export function stopTTS(messageId: string): void {
    getTTSTask(messageId)?.controller?.abort();
}

export function dismissTTS(messageId: string): void {
    clearTTSTask(messageId);
}

function collectInlayIds(content: string): string[] {
    const ids: string[] = [];
    for (const part of deserializeAgentParts(content)) {
        if (part.type !== 'inlay') continue;
        ids.push(...part.ids);
    }
    return ids;
}

function createSourceMacros(source: string): Map<string, Macro> {
    return new Map([
        [
            'source',
            {
                recursive: false,
                run: (args) => {
                    if (args.length !== 0) {
                        throw new AppError('INVALID_INPUT', '{{source}} does not accept arguments');
                    }
                    return source;
                }
            }
        ]
    ]);
}
