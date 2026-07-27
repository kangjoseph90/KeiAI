import { appHttp } from '$lib/adapters/http';
import { fromBase64 } from '$lib/crypto';
import { selectImageGenHandler } from '$lib/imagegen';
import type { Chat } from '$lib/services';
import { AssetService } from '$lib/services/asset';
import { selectSTTHandler, type STTResult } from '$lib/stt';
import { createChatInlay, getAppSettings, getChat } from '$lib/stores';
import { selectTTSHandler } from '$lib/tts';
import { getAssetMediaType, type AssetMediaType } from '$lib/types/asset';
import { AppError } from '$lib/types/errors';
import { createTimestampedFileName } from '$lib/utils/file';

export interface MediaData {
    data: Uint8Array<ArrayBuffer>;
    mimeType: string;
}

export interface GenerateImageRequest {
    prompt: string;
    negativePrompt?: string;
    referenceImages: MediaData[];
    styleImages: MediaData[];
}

export interface GenerateImageInlayRequest {
    prompt: string;
    negativePrompt?: string;
    referenceImageInlayIds: string[];
    styleImageInlayIds: string[];
}

export async function generateImage(
    request: GenerateImageRequest,
    signal: AbortSignal
): Promise<MediaData> {
    if (!request.prompt.trim()) {
        throw new AppError('INVALID_INPUT', 'Image generation prompt cannot be empty');
    }
    validateMedia(request.referenceImages, 'image', 'reference image');
    validateMedia(request.styleImages, 'image', 'style image');

    const settings = await getAppSettings();
    const handler = selectImageGenHandler(settings.imagegenProvider, settings);
    if (!handler) {
        throw new AppError('INVALID_INPUT', 'Failed to create image generation handler');
    }

    const image = await handler.generate(request, signal);
    signal.throwIfAborted();
    return resolveGeneratedImage(image, signal);
}

export async function generateImageInlay(
    chatId: string,
    request: GenerateImageInlayRequest,
    signal: AbortSignal
): Promise<string> {
    const chat = await requireChat(chatId);
    const [referenceImages, styleImages] = await Promise.all([
        loadInlays(chat, request.referenceImageInlayIds, 'image'),
        loadInlays(chat, request.styleImageInlayIds, 'image')
    ]);
    const image = await generateImage(
        {
            prompt: request.prompt,
            ...(request.negativePrompt?.trim()
                ? { negativePrompt: request.negativePrompt.trim() }
                : {}),
            referenceImages,
            styleImages
        },
        signal
    );
    return createGeneratedInlay(chat.id, image, 'Image');
}

export async function* synthesizeSpeech(
    text: string,
    signal: AbortSignal
): AsyncIterable<MediaData> {
    if (!text.trim()) {
        throw new AppError('INVALID_INPUT', 'Text to speech text cannot be empty');
    }

    const settings = await getAppSettings();
    const handler = selectTTSHandler(settings.ttsProvider, settings);
    if (!handler) {
        throw new AppError('INVALID_INPUT', 'Failed to create text to speech handler');
    }

    let mimeType: string | undefined;
    for await (const chunk of handler.synthesize(text, signal)) {
        signal.throwIfAborted();
        const nextMimeType = normalizeMimeType(chunk.mimeType);
        if (getAssetMediaType(nextMimeType) !== 'audio') {
            throw new AppError(
                'NETWORK_ERROR',
                `Text to speech returned invalid media type: ${nextMimeType}`
            );
        }
        if (mimeType && mimeType !== nextMimeType) {
            throw new AppError('NETWORK_ERROR', 'Text to speech returned mixed audio formats');
        }
        mimeType = nextMimeType;
        yield { data: chunk.data, mimeType };
    }
}

export async function synthesizeSpeechInlay(
    chatId: string,
    text: string,
    signal: AbortSignal
): Promise<string> {
    await requireChat(chatId);
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let mimeType: string | undefined;
    for await (const chunk of synthesizeSpeech(text, signal)) {
        mimeType = chunk.mimeType;
        chunks.push(chunk.data);
    }
    if (!mimeType || chunks.length === 0) {
        throw new AppError('NETWORK_ERROR', 'Text to speech returned no audio data');
    }

    return createGeneratedInlay(
        chatId,
        {
            data: concatenateBytes(chunks),
            mimeType
        },
        'Audio'
    );
}

export async function transcribeSpeech(audio: MediaData, signal: AbortSignal): Promise<STTResult> {
    validateMedia([audio], 'audio', 'speech input');
    const settings = await getAppSettings();
    const handler = selectSTTHandler(settings.sttProvider, settings);
    if (!handler) {
        throw new AppError('INVALID_INPUT', 'Failed to create speech to text handler');
    }

    const result = await handler.transcribe(
        new Blob([audio.data], { type: normalizeMimeType(audio.mimeType) }),
        signal
    );
    signal.throwIfAborted();
    return result;
}

export async function transcribeSpeechInlay(
    chatId: string,
    audioInlayId: string,
    signal: AbortSignal
): Promise<string> {
    const chat = await requireChat(chatId);
    const [audio] = await loadInlays(chat, [audioInlayId], 'audio');
    return (await transcribeSpeech(audio, signal)).text;
}

async function requireChat(chatId: string): Promise<Chat> {
    const chat = await getChat(chatId);
    if (!chat) {
        throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);
    }
    return chat;
}

async function loadInlays(
    chat: Chat,
    inlayIds: string[],
    expectedType: AssetMediaType
): Promise<MediaData[]> {
    return Promise.all(
        inlayIds.map(async (id) => {
            const ref = chat.inlays.refs[id];
            if (!ref) {
                throw new AppError('NOT_FOUND', `Inlay not found: ${id}`);
            }
            if (getAssetMediaType(ref.mimeType) !== expectedType) {
                throw new AppError('INVALID_INPUT', `Inlay ${id} is not ${expectedType} media`);
            }

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
                throw new AppError('ASSET_ERROR', `Inlay data is unavailable: ${id}`);
            }
            return {
                data: new Uint8Array(data),
                mimeType: normalizeMimeType(ref.mimeType)
            };
        })
    );
}

async function createGeneratedInlay(
    chatId: string,
    media: MediaData,
    namePrefix: string
): Promise<string> {
    const mimeType = normalizeMimeType(media.mimeType);
    const file = new File(
        [media.data],
        createTimestampedFileName(namePrefix, mediaExtension(mimeType)),
        { type: mimeType }
    );
    return (await createChatInlay(chatId, file)).id;
}

async function resolveGeneratedImage(
    image: { base64?: string; url?: string; mimeType?: string },
    signal: AbortSignal
): Promise<MediaData> {
    if (image.base64) {
        const mimeType = normalizeMimeType(image.mimeType ?? 'image/png');
        validateMediaType(mimeType, 'image', 'generated image');
        return {
            data: fromBase64(image.base64),
            mimeType
        };
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
    const mimeType = normalizeMimeType(
        response.headers.get('content-type') ?? image.mimeType ?? 'image/png'
    );
    validateMediaType(mimeType, 'image', 'generated image');
    return {
        data: new Uint8Array(await response.arrayBuffer()),
        mimeType
    };
}

function validateMedia(media: MediaData[], expectedType: AssetMediaType, label: string): void {
    for (const item of media) {
        if (!(item.data instanceof Uint8Array)) {
            throw new AppError('INVALID_INPUT', `${label} data must be a Uint8Array`);
        }
        validateMediaType(normalizeMimeType(item.mimeType), expectedType, label);
    }
}

function validateMediaType(mimeType: string, expectedType: AssetMediaType, label: string): void {
    if (getAssetMediaType(mimeType) !== expectedType) {
        throw new AppError('INVALID_INPUT', `${label} has invalid media type: ${mimeType}`);
    }
}

function normalizeMimeType(mimeType: string): string {
    return mimeType.trim().toLowerCase().split(';', 1)[0];
}

function concatenateBytes(chunks: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
    const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

function mediaExtension(mimeType: string): string {
    switch (mimeType) {
        case 'image/jpeg':
            return 'jpg';
        case 'image/webp':
            return 'webp';
        case 'image/gif':
            return 'gif';
        case 'audio/wav':
        case 'audio/x-wav':
            return 'wav';
        case 'audio/ogg':
            return 'ogg';
        case 'audio/webm':
            return 'webm';
        case 'audio/mp4':
            return 'm4a';
        case 'audio/mpeg':
            return 'mp3';
        default:
            return 'bin';
    }
}
