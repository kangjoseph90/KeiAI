import type { Chat, IndexedMessage, PagedMessages } from '$lib/services';
import { createTranslationSourceHash } from '$lib/tasks/translation';
import { resolveTranslationPair } from '$lib/language';
import { getAssetMediaType, type AssetMediaType } from '$lib/types/asset';
import { AppError } from '$lib/types/errors';
import { getAppSettings, getChat, updateMessageSwipe } from '$lib/stores';
import type {
    GetAudioAttachmentsNode,
    GetHistoryNode,
    GetImageAttachmentsNode,
    GetTranslationNode,
    SetAudioAttachmentsNode,
    SetHistoryNode,
    SetImageAttachmentsNode,
    SetTranslationNode,
    WorkflowInput,
    WorkflowNodeExecutionContext
} from '../types';
import { deserializeAgentParts, getLastTextContent, serializeAgentParts } from '../agent/llm';
import { asNumber, requireStringInput } from '../operator/utils';
import { createWorkflowValueEvent, requireInput, throwIfAborted } from '../util';

export async function executeGetHistoryNode({
    inputs,
    output,
    messages,
    signal
}: WorkflowNodeExecutionContext<GetHistoryNode>): Promise<void> {
    const { message } = await getHistoryMessage(inputs.index, messages, signal);
    const swipe = message.swipes[message.activeSwipeId];
    output.emit(0, createWorkflowValueEvent(serializeAgentParts(swipe?.parts ?? [])));
}

export async function executeSetHistoryNode({
    inputs,
    messages,
    signal
}: WorkflowNodeExecutionContext<SetHistoryNode>): Promise<void> {
    const [target, content] = await Promise.all([
        getHistoryMessage(inputs.index, messages, signal),
        requireStringInput(inputs.content, 'Set History content input is required', signal)
    ]);
    const swipe = target.message.swipes[target.message.activeSwipeId];
    if (!swipe) throw new AppError('INVALID_INPUT', 'History message has no active swipe');

    await updateMessageSwipe(target.message.id, swipe.id, {
        parts: deserializeAgentParts(content)
    });
    messages?.invalidate(target.index);
}

export async function executeGetImageAttachmentsNode(
    context: WorkflowNodeExecutionContext<GetImageAttachmentsNode>
): Promise<void> {
    await getAttachments(context, 'image');
}

export async function executeSetImageAttachmentsNode(
    context: WorkflowNodeExecutionContext<SetImageAttachmentsNode>
): Promise<void> {
    await setAttachments(context, 'image');
}

export async function executeGetAudioAttachmentsNode(
    context: WorkflowNodeExecutionContext<GetAudioAttachmentsNode>
): Promise<void> {
    await getAttachments(context, 'audio');
}

export async function executeSetAudioAttachmentsNode(
    context: WorkflowNodeExecutionContext<SetAudioAttachmentsNode>
): Promise<void> {
    await setAttachments(context, 'audio');
}

export async function executeGetTranslationNode({
    inputs,
    output,
    messages,
    signal
}: WorkflowNodeExecutionContext<GetTranslationNode>): Promise<void> {
    const { message } = await getHistoryMessage(inputs.index, messages, signal);
    const swipe = message.swipes[message.activeSwipeId];
    output.emit(0, createWorkflowValueEvent(swipe?.translation?.text ?? ''));
}

export async function executeSetTranslationNode({
    inputs,
    messages,
    signal
}: WorkflowNodeExecutionContext<SetTranslationNode>): Promise<void> {
    const [target, content, settings] = await Promise.all([
        getHistoryMessage(inputs.index, messages, signal),
        requireStringInput(inputs.content, 'Set Translation content input is required', signal),
        getAppSettings()
    ]);
    const swipe = target.message.swipes[target.message.activeSwipeId];
    if (!swipe) throw new AppError('INVALID_INPUT', 'History message has no active swipe');

    const sourceText = getLastTextContent(swipe.parts);
    const pair = resolveTranslationPair(sourceText, settings.translation);
    const sourceHash = await createTranslationSourceHash(sourceText, pair.source, pair.target);
    throwIfAborted(signal);
    await updateMessageSwipe(target.message.id, swipe.id, {
        translation: { sourceHash, text: content }
    });
    messages?.invalidate(target.index);
}

async function getAttachments(
    {
        inputs,
        output,
        messages,
        signal
    }: WorkflowNodeExecutionContext<GetImageAttachmentsNode | GetAudioAttachmentsNode>,
    mediaType: 'image' | 'audio'
): Promise<void> {
    const { message } = await getHistoryMessage(inputs.index, messages, signal);
    const swipe = message.swipes[message.activeSwipeId];
    const ids =
        mediaType === 'image' ? (swipe?.imageAttachments ?? []) : (swipe?.audioAttachments ?? []);
    const parts = ids.length > 0 ? [{ type: 'inlay' as const, ids }] : [];
    output.emit(0, createWorkflowValueEvent(serializeAgentParts(parts)));
}

async function setAttachments(
    {
        inputs,
        ctx,
        messages,
        signal
    }: WorkflowNodeExecutionContext<SetImageAttachmentsNode | SetAudioAttachmentsNode>,
    mediaType: 'image' | 'audio'
): Promise<void> {
    if (!ctx?.chatId) throw new AppError('INVALID_INPUT', 'Attachment node requires ctx.chatId');
    const [target, content] = await Promise.all([
        getHistoryMessage(inputs.index, messages, signal),
        requireStringInput(inputs.content, 'Attachment content input is required', signal)
    ]);
    const chat = await getChat(ctx.chatId);
    throwIfAborted(signal);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${ctx.chatId}`);

    const swipe = target.message.swipes[target.message.activeSwipeId];
    if (!swipe) throw new AppError('INVALID_INPUT', 'History message has no active swipe');
    const ids = collectInlayIds(content, chat, mediaType);
    await updateMessageSwipe(
        target.message.id,
        swipe.id,
        mediaType === 'image' ? { imageAttachments: ids } : { audioAttachments: ids }
    );
    messages?.invalidate(target.index);
}

async function getHistoryMessage(
    input: WorkflowInput | undefined,
    messages: PagedMessages | undefined,
    signal: AbortSignal
): Promise<IndexedMessage> {
    if (!messages) throw new AppError('INVALID_INPUT', 'History node requires message history');
    const result = await requireInput(input, 'History index input is required');
    throwIfAborted(signal);
    if (result.status !== 'value') {
        throw new AppError('INVALID_INPUT', 'History index did not produce a value');
    }
    const index = asNumber(result.value);
    const target = await messages.at(index);
    throwIfAborted(signal);
    if (!target) throw new AppError('NOT_FOUND', `History message not found at index: ${index}`);
    return target;
}

function collectInlayIds(
    content: string,
    chat: Chat,
    mediaType: Exclude<AssetMediaType, 'other'>
): string[] {
    const ids: string[] = [];
    for (const part of deserializeAgentParts(content)) {
        if (part.type !== 'inlay') continue;
        for (const id of part.ids) {
            const ref = chat.inlays.refs[id];
            if (ref && getAssetMediaType(ref.mimeType) === mediaType) ids.push(id);
        }
    }
    return ids;
}
