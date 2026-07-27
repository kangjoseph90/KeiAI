import { createChatInlay, getAppSettings, getChat } from '$lib/stores';
import { selectTTSHandler, type TTSStreamChunk } from '$lib/tts';
import { AppError } from '$lib/types/errors';
import { createTimestampedFileName } from '$lib/utils/file';
import type { TTSNode, WorkflowNodeExecutionContext } from '../types';
import { createWorkflowValueEvent, throwIfAborted } from '../util';
import { requireStringInput } from '../operator/utils';
import { serializeAgentParts } from './llm';

export async function executeTTSNode({
    inputs,
    output,
    ctx,
    signal
}: WorkflowNodeExecutionContext<TTSNode>): Promise<void> {
    if (!ctx?.chatId) {
        throw new AppError('INVALID_INPUT', 'Text to Speech node requires ctx.chatId');
    }

    const text = await requireStringInput(
        inputs.text,
        'Text to Speech text input is required',
        signal
    );
    if (!text.trim()) {
        throw new AppError('INVALID_INPUT', 'Text to Speech text cannot be empty');
    }

    const [settings, chat] = await Promise.all([getAppSettings(), getChat(ctx.chatId)]);
    if (!chat) {
        throw new AppError('NOT_FOUND', `Chat not found: ${ctx.chatId}`);
    }

    const handler = selectTTSHandler(settings.ttsProvider, settings);
    if (!handler) {
        throw new AppError('INVALID_INPUT', 'Failed to create text to speech handler');
    }

    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let mimeType: string | undefined;
    for await (const chunk of handler.synthesize(text, signal)) {
        throwIfAborted(signal);
        mimeType = resolveMimeType(mimeType, chunk);
        chunks.push(chunk.data);
    }
    if (!mimeType || chunks.length === 0) {
        throw new AppError('NETWORK_ERROR', 'Text to speech returned no audio data');
    }

    const file = new File(chunks, createTimestampedFileName('Audio', audioExtension(mimeType)), {
        type: mimeType
    });
    const ref = await createChatInlay(chat.id, file);
    output.emit(
        0,
        createWorkflowValueEvent(serializeAgentParts([{ type: 'inlay', ids: [ref.id] }]))
    );
}

function resolveMimeType(current: string | undefined, chunk: TTSStreamChunk): string {
    const next = chunk.mimeType.trim().toLowerCase().split(';', 1)[0];
    if (!next.startsWith('audio/')) {
        throw new AppError('NETWORK_ERROR', `Text to speech returned invalid media type: ${next}`);
    }
    if (current && current !== next) {
        throw new AppError('NETWORK_ERROR', 'Text to speech returned mixed audio formats');
    }
    return next;
}

function audioExtension(mimeType: string): string {
    switch (mimeType) {
        case 'audio/wav':
        case 'audio/x-wav':
            return 'wav';
        case 'audio/ogg':
            return 'ogg';
        case 'audio/webm':
            return 'webm';
        case 'audio/mp4':
            return 'm4a';
        default:
            return 'mp3';
    }
}
