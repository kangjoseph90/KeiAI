import { appHttp } from '$lib/adapters/http';
import { createAsyncCache } from '$lib/adapters/cache';
import { fromBase64, sha256, toBase64 } from '$lib/crypto';
import { AppError } from '$lib/types/errors';
import { buildUrl } from '$lib/utils/url';
import type { ImageGenHandler, ImageGenImage, ImageGenInput, ImageGenRequest } from '../types';

const vibeEncodingCache = createAsyncCache<string>('novelai-vibe-encodings', 100);

export interface NovelAIImageGenConfig {
    apiKey?: string;
    baseUrl: string;
    modelId: string;
    width: number;
    height: number;
    sampler: string;
    noiseSchedule: string;
    steps: number;
    scale: number;
    cfgRescale: number;
    vibeInformationExtracted: number;
    vibeStrength: number;
    referenceStrength: number;
    referenceFidelity: number;
    useProxy?: boolean;
}

export class NovelAIImageGenHandler implements ImageGenHandler {
    private readonly config: NovelAIImageGenConfig;

    constructor(config: NovelAIImageGenConfig) {
        this.config = config;
    }

    async generate(request: ImageGenRequest, signal?: AbortSignal): Promise<ImageGenImage> {
        if (request.referenceImages.length > 0 && request.styleImages.length > 0) {
            throw new AppError(
                'INVALID_INPUT',
                'NovelAI Vibe Transfer and Precise Reference cannot be used together'
            );
        }

        const [references, vibes] = await Promise.all([
            this.prepareReferences(request.referenceImages),
            this.encodeVibes(request.styleImages, signal)
        ]);
        const negativePrompt = request.negativePrompt?.trim() ?? '';
        const seed = randomSeed();
        const parameters: NovelAIRequestParameters = {
            params_version: 3,
            width: this.config.width,
            height: this.config.height,
            sampler: this.config.sampler,
            noise_schedule: this.config.noiseSchedule,
            steps: this.config.steps,
            scale: this.config.scale,
            cfg_rescale: this.config.cfgRescale,
            seed,
            extra_noise_seed: randomSeed(),
            n_samples: 1,
            negative_prompt: negativePrompt,
            qualityToggle: false,
            ucPreset: 3,
            add_original_image: true,
            dynamic_thresholding: false,
            controlnet_strength: 1,
            uncond_scale: 1,
            legacy: false,
            legacy_v3_extend: false,
            autoSmea: false,
            use_coords: false,
            prefer_brownian: true,
            deliberate_euler_ancestral_bug: false,
            v4_prompt: v4Condition(request.prompt),
            v4_negative_prompt: {
                ...v4Condition(negativePrompt),
                legacy_uc: false
            },
            reference_image_multiple: vibes,
            reference_information_extracted_multiple: vibes.map(
                () => this.config.vibeInformationExtracted
            ),
            reference_strength_multiple: vibes.map(() => this.config.vibeStrength),
            director_reference_images: references,
            director_reference_descriptions: references.map(() => v4Condition('character')),
            director_reference_information_extracted: references.map(() => 1),
            director_reference_strength_values: references.map(() => this.config.referenceStrength),
            director_reference_secondary_strength_values: references.map(
                () => this.config.referenceFidelity
            )
        };

        const response = await appHttp.fetch(
            buildUrl(this.config.baseUrl, '/ai/generate-image'),
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {})
                },
                body: JSON.stringify({
                    action: 'generate',
                    input: request.prompt,
                    model: this.config.modelId,
                    parameters
                }),
                signal
            },
            { proxy: this.config.useProxy ?? true, signal }
        );

        if (!response.ok) {
            const error = await response.text().catch(() => '');
            throw new AppError(
                'NETWORK_ERROR',
                `NovelAI ImageGen failed (${response.status})${error ? `: ${error}` : ''}`
            );
        }

        const json = (await response.json()) as NovelAIImageResponse;
        const image = json.images?.[0]?.image;
        if (!image) {
            throw new AppError('NETWORK_ERROR', 'NovelAI ImageGen returned no image');
        }
        return { data: fromBase64(image), mimeType: 'image/png' };
    }

    private async encodeVibes(images: ImageGenInput[], signal?: AbortSignal): Promise<string[]> {
        return Promise.all(images.map((image) => this.encodeVibe(image, signal)));
    }

    private async encodeVibe(image: ImageGenInput, signal?: AbortSignal): Promise<string> {
        const imageHash = await sha256(image.data);
        const cacheKey = [
            this.config.modelId,
            this.config.vibeInformationExtracted,
            imageHash
        ].join(':');
        const cached = await vibeEncodingCache.get(cacheKey).catch(() => undefined);
        if (cached) return cached;

        const response = await appHttp.fetch(
            buildUrl(this.config.baseUrl, '/ai/encode-vibe'),
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/octet-stream',
                    ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {})
                },
                body: JSON.stringify({
                    image: toBase64(image.data),
                    model: this.config.modelId,
                    information_extracted: this.config.vibeInformationExtracted
                }),
                signal
            },
            { proxy: this.config.useProxy ?? true, signal }
        );

        if (!response.ok) {
            const error = await response.text().catch(() => '');
            throw new AppError(
                'NETWORK_ERROR',
                `NovelAI Vibe encoding failed (${response.status})${error ? `: ${error}` : ''}`
            );
        }

        const encoding = toBase64(new Uint8Array(await response.arrayBuffer()));
        await vibeEncodingCache.set(cacheKey, encoding).catch(() => undefined);
        return encoding;
    }

    private async prepareReferences(images: ImageGenInput[]): Promise<string[]> {
        return Promise.all(images.map(prepareReferenceImage));
    }
}

async function prepareReferenceImage(image: ImageGenInput): Promise<string> {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
        throw new AppError(
            'NOT_IMPLEMENTED',
            'Precise Reference image processing is unavailable in this runtime'
        );
    }

    const bitmap = await createImageBitmap(new Blob([image.data], { type: image.mimeType })).catch(
        () => null
    );
    if (!bitmap) {
        throw new AppError('INVALID_INPUT', 'NovelAI reference image could not be decoded');
    }

    const target = chooseReferenceSize(bitmap.width / bitmap.height);
    const canvas = new OffscreenCanvas(target.width, target.height);
    const context = canvas.getContext('2d');
    if (!context) {
        bitmap.close();
        throw new AppError('NOT_IMPLEMENTED', 'Canvas rendering is unavailable in this runtime');
    }

    const scale = Math.min(target.width / bitmap.width, target.height / bitmap.height);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const x = Math.round((target.width - width) / 2);
    const y = Math.round((target.height - height) / 2);

    context.fillStyle = '#000000';
    context.fillRect(0, 0, target.width, target.height);
    context.drawImage(bitmap, x, y, width, height);
    bitmap.close();

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

function chooseReferenceSize(aspectRatio: number): { width: number; height: number } {
    const sizes = [
        { width: 1024, height: 1536 },
        { width: 1472, height: 1472 },
        { width: 1536, height: 1024 }
    ];
    let closest = sizes[0];
    let closestDistance = Math.abs(Math.log(aspectRatio / (closest.width / closest.height)));
    for (const size of sizes.slice(1)) {
        const distance = Math.abs(Math.log(aspectRatio / (size.width / size.height)));
        if (distance < closestDistance) {
            closest = size;
            closestDistance = distance;
        }
    }
    return closest;
}

function randomSeed(): number {
    return Math.floor(Math.random() * 4_294_967_296);
}

function v4Condition(baseCaption: string): NovelAIV4Condition {
    return {
        caption: {
            base_caption: baseCaption,
            char_captions: []
        },
        use_coords: false,
        use_order: true
    };
}

interface NovelAIImageResponse {
    images?: Array<{
        image?: string;
        index?: number;
        seed?: number;
    }>;
}

interface NovelAIV4Condition {
    caption: {
        base_caption: string;
        char_captions: [];
    };
    use_coords: boolean;
    use_order: boolean;
    legacy_uc?: boolean;
}

interface NovelAIRequestParameters {
    params_version: number;
    width: number;
    height: number;
    sampler: string;
    noise_schedule: string;
    steps: number;
    scale: number;
    cfg_rescale: number;
    seed: number;
    extra_noise_seed: number;
    n_samples: 1;
    negative_prompt: string;
    qualityToggle: boolean;
    ucPreset: number;
    add_original_image: boolean;
    dynamic_thresholding: boolean;
    controlnet_strength: number;
    uncond_scale: number;
    legacy: boolean;
    legacy_v3_extend: boolean;
    autoSmea: boolean;
    use_coords: boolean;
    prefer_brownian: boolean;
    deliberate_euler_ancestral_bug: boolean;
    v4_prompt: NovelAIV4Condition;
    v4_negative_prompt: NovelAIV4Condition;
    reference_image_multiple: string[];
    reference_information_extracted_multiple: number[];
    reference_strength_multiple: number[];
    director_reference_images: string[];
    director_reference_descriptions: NovelAIV4Condition[];
    director_reference_information_extracted: number[];
    director_reference_strength_values: number[];
    director_reference_secondary_strength_values: number[];
}
