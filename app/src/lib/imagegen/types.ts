/**
 * ImageGen Types — KeiAI
 *
 * Shared interfaces for the image generation adapter layer.
 * Non-streaming: returns generated images in one shot.
 */

export interface ImageGenImage {
    /** Base64-encoded image data (PNG/JPEG) */
    base64?: string;
    /** URL to the generated image */
    url?: string;
    /** Media type of the generated image when provided by the provider */
    mimeType?: string;
}

export interface ImageGenInput {
    data: Uint8Array<ArrayBuffer>;
    mimeType: string;
}

export interface ImageGenRequest {
    prompt: string;
    negativePrompt?: string;
    referenceImages: ImageGenInput[];
    styleImages: ImageGenInput[];
}

export interface ImageGenHandler {
    generate(request: ImageGenRequest, signal?: AbortSignal): Promise<ImageGenImage>;
}
