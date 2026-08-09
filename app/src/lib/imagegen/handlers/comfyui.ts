import { appHttp } from '$lib/adapters/http';
import { toBase64 } from '$lib/crypto';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { buildUrl } from '$lib/utils/url';
import type { ImageGenHandler, ImageGenImage, ImageGenInput, ImageGenRequest } from '../types';

export interface ComfyUIImageGenConfig {
    baseUrl: string;
    workflow: string;
    timeoutSeconds: number;
    useProxy?: boolean;
}

interface ComfyNode {
    inputs: Record<string, unknown>;
    [key: string]: unknown;
}

type ComfyWorkflow = Record<string, ComfyNode>;

interface UploadedImage {
    name: string;
    subfolder?: string;
    type?: string;
}

interface PromptResponse {
    prompt_id?: string;
    error?: string;
    node_errors?: unknown;
}

interface HistoryImage {
    filename?: string;
    subfolder?: string;
    type?: string;
}

interface HistoryOutput {
    images?: HistoryImage[];
}

interface HistoryItem {
    outputs?: Record<string, HistoryOutput>;
}

export class ComfyUIImageGenHandler implements ImageGenHandler {
    private readonly config: ComfyUIImageGenConfig;

    constructor(config: ComfyUIImageGenConfig) {
        this.config = config;
    }

    async generate(request: ImageGenRequest, signal?: AbortSignal): Promise<ImageGenImage> {
        const workflow = parseWorkflow(this.config.workflow);
        if (!workflowContains(workflow, '{{prompt}}')) {
            throw new AppError('INVALID_INPUT', 'ComfyUI workflow has no {{prompt}} placeholder');
        }
        const replacements = new Map<string, string>([
            ['{{prompt}}', request.prompt],
            ['{{negative_prompt}}', request.negativePrompt ?? '']
        ]);

        await Promise.all([
            this.addImageReplacements(
                workflow,
                'reference_image',
                request.referenceImages,
                replacements,
                signal
            ),
            this.addImageReplacements(
                workflow,
                'style_image',
                request.styleImages,
                replacements,
                signal
            )
        ]);

        replaceWorkflowInputs(workflow, replacements);
        const promptId = await this.queueWorkflow(workflow, signal);
        const output = await this.waitForOutput(promptId, signal);
        return this.downloadOutput(output, signal);
    }

    private async addImageReplacements(
        workflow: ComfyWorkflow,
        placeholder: string,
        images: ImageGenInput[],
        replacements: Map<string, string>,
        signal?: AbortSignal
    ): Promise<void> {
        if (images.length === 0) return;

        let used = false;
        await Promise.all(
            images.map(async (image, index) => {
                const aliases =
                    index === 0
                        ? [`{{${placeholder}}}`, `{{${placeholder}_1}}`]
                        : [`{{${placeholder}_${index + 1}}}`];
                if (!aliases.some((alias) => workflowContains(workflow, alias))) return;

                used = true;
                const uploaded = await this.uploadImage(image, signal);
                const imageName = uploaded.subfolder
                    ? `${uploaded.subfolder}/${uploaded.name}`
                    : uploaded.name;
                for (const alias of aliases) {
                    replacements.set(alias, imageName);
                }
            })
        );

        if (!used) {
            throw new AppError(
                'INVALID_INPUT',
                `ComfyUI workflow has no {{${placeholder}}} placeholder`
            );
        }
    }

    private async uploadImage(image: ImageGenInput, signal?: AbortSignal): Promise<UploadedImage> {
        const form = new FormData();
        form.append(
            'image',
            new Blob([image.data], { type: image.mimeType }),
            `keiai-${generateId()}.${extensionForMimeType(image.mimeType)}`
        );
        form.append('type', 'input');
        form.append('overwrite', 'true');

        const response = await appHttp.fetch(
            this.url('/upload/image'),
            {
                method: 'POST',
                body: form,
                signal
            },
            { proxy: this.config.useProxy ?? true, signal }
        );
        if (!response.ok) {
            throw await comfyError(response, 'image upload');
        }

        const uploaded = (await response.json()) as UploadedImage;
        if (!uploaded.name) {
            throw new AppError('NETWORK_ERROR', 'ComfyUI image upload returned no filename');
        }
        return uploaded;
    }

    private async queueWorkflow(workflow: ComfyWorkflow, signal?: AbortSignal): Promise<string> {
        const response = await appHttp.fetch(
            this.url('/prompt'),
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt: workflow,
                    client_id: generateId()
                }),
                signal
            },
            { proxy: this.config.useProxy ?? true, signal }
        );
        if (!response.ok) {
            throw await comfyError(response, 'workflow submission');
        }

        const result = (await response.json()) as PromptResponse;
        if (!result.prompt_id) {
            const details = result.error ?? formatNodeErrors(result.node_errors);
            throw new AppError(
                'INVALID_INPUT',
                `ComfyUI rejected the workflow${details ? `: ${details}` : ''}`
            );
        }
        return result.prompt_id;
    }

    private async waitForOutput(promptId: string, signal?: AbortSignal): Promise<HistoryImage> {
        const deadline = Date.now() + this.config.timeoutSeconds * 1000;

        while (Date.now() < deadline) {
            signal?.throwIfAborted();
            const response = await appHttp.fetch(
                this.url(`/history/${promptId}`),
                { signal },
                { proxy: this.config.useProxy ?? true, signal }
            );
            if (!response.ok) {
                throw await comfyError(response, 'history lookup');
            }

            const history = (await response.json()) as Record<string, HistoryItem>;
            const item = history[promptId];
            if (item) {
                const image = firstOutputImage(item);
                if (image) return image;
                throw new AppError('NETWORK_ERROR', 'ComfyUI workflow completed without an image');
            }
            await delay(500, signal);
        }

        throw new AppError(
            'NETWORK_ERROR',
            `ComfyUI image generation timed out after ${this.config.timeoutSeconds} seconds`
        );
    }

    private async downloadOutput(
        output: HistoryImage,
        signal?: AbortSignal
    ): Promise<ImageGenImage> {
        if (!output.filename) {
            throw new AppError('NETWORK_ERROR', 'ComfyUI output has no filename');
        }

        const response = await appHttp.fetch(
            this.url('/view', {
                filename: output.filename,
                subfolder: output.subfolder ?? '',
                type: output.type ?? 'output'
            }),
            { signal },
            { proxy: this.config.useProxy ?? true, signal }
        );
        if (!response.ok) {
            throw await comfyError(response, 'output download');
        }

        return {
            base64: toBase64(new Uint8Array(await response.arrayBuffer())),
            mimeType: response.headers.get('content-type')?.split(';')[0] || 'image/png'
        };
    }

    private url(path: string, params?: Record<string, string>): string {
        let url: URL;
        try {
            url = new URL(buildUrl(this.config.baseUrl, path));
        } catch (error) {
            throw new AppError('INVALID_INPUT', 'ComfyUI base URL is invalid', error);
        }
        if (params) {
            url.search = new URLSearchParams(params).toString();
        }
        return url.toString();
    }
}

function parseWorkflow(source: string): ComfyWorkflow {
    if (!source.trim()) {
        throw new AppError('INVALID_INPUT', 'ComfyUI API workflow is empty');
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(source);
    } catch (error) {
        throw new AppError('INVALID_INPUT', 'ComfyUI API workflow is not valid JSON', error);
    }
    if (!isRecord(parsed) || Object.keys(parsed).length === 0) {
        throw new AppError('INVALID_INPUT', 'ComfyUI API workflow must be a JSON object');
    }

    for (const node of Object.values(parsed)) {
        if (!isRecord(node) || !isRecord(node.inputs)) {
            throw new AppError('INVALID_INPUT', 'ComfyUI API workflow contains an invalid node');
        }
    }
    return parsed as ComfyWorkflow;
}

function replaceWorkflowInputs(
    workflow: ComfyWorkflow,
    replacements: ReadonlyMap<string, string>
): void {
    for (const node of Object.values(workflow)) {
        for (const [key, value] of Object.entries(node.inputs)) {
            node.inputs[key] = replaceValue(value, replacements);
        }
    }
}

function workflowContains(workflow: ComfyWorkflow, placeholder: string): boolean {
    return Object.values(workflow).some((node) => valueContains(node.inputs, placeholder));
}

function valueContains(value: unknown, placeholder: string): boolean {
    if (typeof value === 'string') return value.includes(placeholder);
    if (Array.isArray(value)) return value.some((item) => valueContains(item, placeholder));
    if (isRecord(value)) {
        return Object.values(value).some((item) => valueContains(item, placeholder));
    }
    return false;
}

function replaceValue(value: unknown, replacements: ReadonlyMap<string, string>): unknown {
    if (typeof value === 'string') {
        let result = value;
        for (const [placeholder, replacement] of replacements) {
            result = result.replaceAll(placeholder, replacement);
        }
        return result;
    }
    if (Array.isArray(value)) {
        return value.map((item) => replaceValue(item, replacements));
    }
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, replaceValue(item, replacements)])
        );
    }
    return value;
}

function firstOutputImage(item: HistoryItem): HistoryImage | undefined {
    if (!item.outputs) return undefined;
    for (const output of Object.values(item.outputs)) {
        const image = output.images?.[0];
        if (image) return image;
    }
    return undefined;
}

function extensionForMimeType(mimeType: string): string {
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatNodeErrors(errors: unknown): string {
    if (!errors) return '';
    try {
        return JSON.stringify(errors);
    } catch {
        return String(errors);
    }
}

async function comfyError(response: Response, action: string): Promise<AppError> {
    const details = await response.text().catch(() => '');
    return new AppError(
        'NETWORK_ERROR',
        `ComfyUI ${action} failed (${response.status})${details ? `: ${details}` : ''}`
    );
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }

        const onAbort = (): void => {
            clearTimeout(timer);
            reject(signal?.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, milliseconds);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
