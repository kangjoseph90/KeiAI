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
}

export interface ImageGenResult {
	images: ImageGenImage[];
}

export interface ImageGenHandler {
	generate(prompt: string, signal?: AbortSignal): Promise<ImageGenResult>;
}
