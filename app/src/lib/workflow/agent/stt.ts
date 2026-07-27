import { AssetService } from '$lib/services/asset';
import type { Chat } from '$lib/services';
import { selectSTTHandler } from '$lib/stt';
import { getAppSettings, getChat } from '$lib/stores';
import { AppError } from '$lib/types/errors';
import { getAssetMediaType } from '$lib/types/asset';
import type { STTNode, WorkflowNodeExecutionContext } from '../types';
import { createWorkflowValueEvent, throwIfAborted } from '../util';
import { requireStringInput } from '../operator/utils';
import { deserializeAgentParts } from './llm';

export async function executeSTTNode({
    inputs,
    output,
    ctx,
    signal
}: WorkflowNodeExecutionContext<STTNode>): Promise<void> {
    if (!ctx?.chatId) {
        throw new AppError('INVALID_INPUT', 'Speech to Text node requires ctx.chatId');
    }

    const content = await requireStringInput(
        inputs.audio,
        'Speech to Text audio input is required',
        signal
    );
    const [settings, chat] = await Promise.all([getAppSettings(), getChat(ctx.chatId)]);
    if (!chat) {
        throw new AppError('NOT_FOUND', `Chat not found: ${ctx.chatId}`);
    }

    const audioFiles = await loadAudioInputs(content, chat);
    const handler = selectSTTHandler(settings.sttProvider, settings);
    if (!handler) {
        throw new AppError('INVALID_INPUT', 'Failed to create speech to text handler');
    }

    const transcripts: string[] = [];
    for (const audio of audioFiles) {
        const result = await handler.transcribe(audio, signal);
        throwIfAborted(signal);
        if (result.text.trim()) transcripts.push(result.text.trim());
    }
    output.emit(0, createWorkflowValueEvent(transcripts.join('\n')));
}

async function loadAudioInputs(content: string, chat: Chat): Promise<File[]> {
    const audioIds: string[] = [];
    for (const part of deserializeAgentParts(content)) {
        if (part.type !== 'inlay') continue;
        for (const id of part.ids) {
            const ref = chat.inlays.refs[id];
            if (ref && getAssetMediaType(ref.mimeType) === 'audio') {
                audioIds.push(id);
            }
        }
    }

    if (audioIds.length === 0) {
        throw new AppError('INVALID_INPUT', 'Speech to Text input contains no audio inlay');
    }
    const files: File[] = [];
    for (const id of audioIds) {
        const ref = chat.inlays.refs[id];
        const locator = {
            scopeType: chat.scopeType,
            scopeId: chat.scopeId,
            ownerTable: 'chats',
            ownerId: chat.id,
            hash: ref.hash
        } as const;
        let data = await AssetService.readBytes(locator);
        if (!data) {
            await AssetService.load({
                ...locator,
                encKey: ref.encKey,
                mimeType: ref.mimeType
            });
            data = await AssetService.readBytes(locator);
        }
        if (!data) {
            throw new AppError('ASSET_ERROR', `Audio inlay data is unavailable: ${ref.id}`);
        }
        files.push(new File([new Uint8Array(data)], ref.name, { type: ref.mimeType }));
    }
    return files;
}
