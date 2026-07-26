import { appHttp } from '$lib/adapters/http';
import { fromBase64 } from '$lib/crypto';
import { selectImageGenHandler, type ImageGenImage, type ImageGenInput } from '$lib/imagegen';
import { AssetService } from '$lib/services/asset';
import type { Chat } from '$lib/services';
import { AppError } from '$lib/types/errors';
import { getAssetMediaType } from '$lib/types/asset';
import { createChatInlay, getAppSettings, getChat } from '$lib/stores';
import type { ImageGenerationNode, WorkflowNodeExecutionContext } from '../types';
import { createWorkflowValueEvent, throwIfAborted } from '../util';
import { requireStringInput } from '../operator/utils';
import { deserializeAgentParts, serializeAgentParts } from './llm';

export async function executeImageGenerationNode({
    inputs,
    output,
    ctx,
    signal
}: WorkflowNodeExecutionContext<ImageGenerationNode>): Promise<void> {
    if (!ctx?.chatId) {
        throw new AppError('INVALID_INPUT', 'Image Generation node requires ctx.chatId');
    }

    const [prompt, negativePrompt, referenceContent, styleContent] = await Promise.all([
        requireStringInput(inputs.prompt, 'Image Generation prompt input is required', signal),
        requireStringInput(
            inputs.negativePrompt,
            'Image Generation negative prompt input is required',
            signal
        ),
        requireStringInput(
            inputs.referenceImages,
            'Image Generation reference images input is required',
            signal
        ),
        requireStringInput(
            inputs.styleImages,
            'Image Generation style images input is required',
            signal
        )
    ]);
    if (!prompt.trim()) {
        throw new AppError('INVALID_INPUT', 'Image Generation prompt cannot be empty');
    }

    const [settings, chat] = await Promise.all([getAppSettings(), getChat(ctx.chatId)]);
    if (!chat) {
        throw new AppError('NOT_FOUND', `Chat not found: ${ctx.chatId}`);
    }

    const handler = selectImageGenHandler(settings.imagegenProvider, settings);
    if (!handler) {
        throw new AppError('INVALID_INPUT', 'Failed to create image generation handler');
    }

    const [referenceImages, styleImages] = await Promise.all([
        loadImageInputs(referenceContent, chat),
        loadImageInputs(styleContent, chat)
    ]);
    const image = await handler.generate(
        {
            prompt,
            ...(negativePrompt.trim() ? { negativePrompt } : {}),
            referenceImages,
            styleImages
        },
        signal
    );
    throwIfAborted(signal);

    const file = await imageToFile(image, signal);
    const ref = await createChatInlay(chat.id, file);
    output.emit(
        0,
        createWorkflowValueEvent(serializeAgentParts([{ type: 'inlay', ids: [ref.id] }]))
    );
}

async function loadImageInputs(content: string, chat: Chat): Promise<ImageGenInput[]> {
    const images: ImageGenInput[] = [];
    for (const part of deserializeAgentParts(content)) {
        if (part.type !== 'inlay') continue;

        for (const id of part.ids) {
            const ref = chat.inlays.refs[id];
            if (!ref || getAssetMediaType(ref.mimeType) !== 'image') continue;

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
            if (!data) continue;
            images.push({
                data: new Uint8Array(data),
                mimeType: ref.mimeType
            });
        }
    }
    return images;
}

async function imageToFile(image: ImageGenImage, signal: AbortSignal): Promise<File> {
    if (image.base64) {
        const mimeType = image.mimeType ?? 'image/png';
        return new File([fromBase64(image.base64)], `generated-image.${imageExtension(mimeType)}`, {
            type: mimeType
        });
    }

    if (!image.url) {
        throw new AppError('NETWORK_ERROR', 'Image generation returned no image data');
    }

    const response = await appHttp.fetch(image.url, { signal });
    if (!response.ok) {
        throw new AppError(
            'NETWORK_ERROR',
            `Failed to download generated image: ${response.status}`
        );
    }
    const mimeType = response.headers.get('content-type')?.split(';', 1)[0] ?? 'image/png';
    return new File([await response.arrayBuffer()], `generated-image.${imageExtension(mimeType)}`, {
        type: mimeType
    });
}

function imageExtension(mimeType: string): string {
    switch (mimeType) {
        case 'image/jpeg':
            return 'jpg';
        case 'image/webp':
            return 'webp';
        case 'image/gif':
            return 'gif';
        default:
            return 'png';
    }
}
