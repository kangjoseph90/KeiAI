/**
 * Mock Image Generation Handler — Development / Testing
 */

import { toBase64 } from '$lib/crypto';
import { AppError } from '$lib/types/errors';
import type { ImageGenHandler, ImageGenImage, ImageGenInput, ImageGenRequest } from '../types';

const WIDTH = 1024;
const MARGIN = 40;
const THUMBNAIL_SIZE = 200;
const THUMBNAIL_GAP = 16;
const THUMBNAIL_COLUMNS = 4;

export type MockImageGenBehavior = 'sample' | 'diagnostic';

export interface MockImageGenConfig {
    behavior?: MockImageGenBehavior;
}

export class MockImageGenHandler implements ImageGenHandler {
    private readonly behavior: MockImageGenBehavior;

    constructor(config: MockImageGenConfig = {}) {
        this.behavior = config.behavior ?? 'sample';
    }

    async generate(request: ImageGenRequest, signal?: AbortSignal): Promise<ImageGenImage> {
        signal?.throwIfAborted();
        if (typeof OffscreenCanvas === 'undefined') {
            throw new AppError(
                'NOT_IMPLEMENTED',
                'Canvas rendering is unavailable in this runtime'
            );
        }

        if (this.behavior === 'sample') {
            return renderWhiteImage();
        }
        return renderDiagnosticImage(request, signal);
    }
}

async function renderWhiteImage(): Promise<ImageGenImage> {
    const canvas = new OffscreenCanvas(768, 768);
    const context = canvas.getContext('2d');
    if (!context) {
        throw new AppError('NOT_IMPLEMENTED', 'Canvas rendering is unavailable in this runtime');
    }
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvasImage(canvas);
}

async function renderDiagnosticImage(
    request: ImageGenRequest,
    signal?: AbortSignal
): Promise<ImageGenImage> {
    const referenceHeight = imageSectionHeight(request.referenceImages.length);
    const styleHeight = imageSectionHeight(request.styleImages.length);
    const canvas = new OffscreenCanvas(WIDTH, 330 + referenceHeight + styleHeight);
    const context = canvas.getContext('2d');
    if (!context) {
        throw new AppError('NOT_IMPLEMENTED', 'Canvas rendering is unavailable in this runtime');
    }

    context.fillStyle = '#f8fafc';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111827';
    context.fillRect(0, 0, canvas.width, 88);
    context.fillStyle = '#ffffff';
    context.font = 'bold 32px sans-serif';
    context.fillText('MOCK IMAGE · DIAGNOSTIC', MARGIN, 55);

    context.fillStyle = '#111827';
    context.font = 'bold 18px sans-serif';
    context.fillText('PROMPT', MARGIN, 125);
    context.font = '16px sans-serif';
    drawWrappedText(context, request.prompt, MARGIN, 154, WIDTH - MARGIN * 2, 22, 5);

    context.fillStyle = '#991b1b';
    context.font = 'bold 16px sans-serif';
    context.fillText('NEGATIVE', MARGIN, 274);
    context.fillStyle = '#374151';
    context.font = '15px sans-serif';
    drawWrappedText(
        context,
        request.negativePrompt?.trim() || '(none)',
        MARGIN + 100,
        274,
        WIDTH - MARGIN * 2 - 100,
        20,
        2
    );

    let y = 315;
    y = await drawImageSection(context, 'REFERENCE IMAGES', request.referenceImages, y, signal);
    await drawImageSection(context, 'STYLE IMAGES', request.styleImages, y, signal);

    return canvasImage(canvas);
}

function imageSectionHeight(count: number): number {
    const rows = Math.max(1, Math.ceil(count / THUMBNAIL_COLUMNS));
    return 54 + rows * (THUMBNAIL_SIZE + 46);
}

async function drawImageSection(
    context: OffscreenCanvasRenderingContext2D,
    title: string,
    images: ImageGenInput[],
    y: number,
    signal?: AbortSignal
): Promise<number> {
    context.fillStyle = '#111827';
    context.font = 'bold 18px sans-serif';
    context.fillText(`${title} · ${images.length}`, MARGIN, y + 24);

    if (images.length === 0) {
        context.fillStyle = '#6b7280';
        context.font = '15px sans-serif';
        context.fillText('(none)', MARGIN, y + 61);
        return y + imageSectionHeight(0);
    }

    for (let index = 0; index < images.length; index += 1) {
        signal?.throwIfAborted();
        const column = index % THUMBNAIL_COLUMNS;
        const row = Math.floor(index / THUMBNAIL_COLUMNS);
        const x = MARGIN + column * (THUMBNAIL_SIZE + THUMBNAIL_GAP);
        const imageY = y + 44 + row * (THUMBNAIL_SIZE + 46);
        await drawInputImage(context, images[index], index, x, imageY);
    }

    return y + imageSectionHeight(images.length);
}

async function drawInputImage(
    context: OffscreenCanvasRenderingContext2D,
    image: ImageGenInput,
    index: number,
    x: number,
    y: number
): Promise<void> {
    context.fillStyle = '#e5e7eb';
    context.fillRect(x, y, THUMBNAIL_SIZE, THUMBNAIL_SIZE);

    const bitmap =
        typeof createImageBitmap === 'function'
            ? await createImageBitmap(new Blob([image.data], { type: image.mimeType })).catch(
                  () => null
              )
            : null;
    if (bitmap) {
        const scale = Math.min(THUMBNAIL_SIZE / bitmap.width, THUMBNAIL_SIZE / bitmap.height);
        const width = bitmap.width * scale;
        const height = bitmap.height * scale;
        context.drawImage(
            bitmap,
            x + (THUMBNAIL_SIZE - width) / 2,
            y + (THUMBNAIL_SIZE - height) / 2,
            width,
            height
        );
        bitmap.close();
    } else {
        context.fillStyle = '#991b1b';
        context.font = 'bold 15px sans-serif';
        context.fillText('DECODE FAILED', x + 34, y + THUMBNAIL_SIZE / 2);
    }

    context.strokeStyle = '#9ca3af';
    context.strokeRect(x, y, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    context.fillStyle = '#374151';
    context.font = '13px sans-serif';
    context.fillText(`#${index + 1} · ${image.mimeType}`, x, y + THUMBNAIL_SIZE + 20);
}

function drawWrappedText(
    context: OffscreenCanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    maxLines: number
): void {
    const words = text.replace(/\s+/g, ' ').trim().split(' ');
    let line = '';
    let lineIndex = 0;
    for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (context.measureText(candidate).width <= maxWidth) {
            line = candidate;
            continue;
        }
        context.fillText(line, x, y + lineIndex * lineHeight);
        lineIndex += 1;
        if (lineIndex >= maxLines) return;
        line = word;
    }
    if (line && lineIndex < maxLines) {
        context.fillText(line, x, y + lineIndex * lineHeight);
    }
}

async function canvasImage(canvas: OffscreenCanvas): Promise<ImageGenImage> {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return {
        base64: toBase64(new Uint8Array(await blob.arrayBuffer())),
        mimeType: 'image/png'
    };
}
