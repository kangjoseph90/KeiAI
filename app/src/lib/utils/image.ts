export interface ImagePreprocessOptions {
    maxWidth: number;
    maxHeight: number;
    quality: number;
    type?: 'image/webp';
}

function loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(img.src);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(img.src);
            reject(new Error('Failed to load image'));
        };
        img.src = URL.createObjectURL(file);
    });
}

export async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
    const image = await loadImage(file);
    return {
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height
    };
}

export function readVideoDimensions(
    file: File,
    mimeType = file.type
): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        const source = file.type === mimeType ? file : new Blob([file], { type: mimeType });
        const url = URL.createObjectURL(source);

        const cleanup = () => {
            video.onloadedmetadata = null;
            video.onerror = null;
            URL.revokeObjectURL(url);
        };

        video.onloadedmetadata = () => {
            const { videoWidth: width, videoHeight: height } = video;
            cleanup();
            if (width > 0 && height > 0) {
                resolve({ width, height });
            } else {
                reject(new Error('Video has no dimensions'));
            }
        };
        video.onerror = () => {
            cleanup();
            reject(new Error('Failed to load video metadata'));
        };
        video.preload = 'metadata';
        video.src = url;
    });
}

function calculateDimensions(
    width: number,
    height: number,
    maxWidth: number,
    maxHeight: number
): { width: number; height: number } {
    if (width <= maxWidth && height <= maxHeight) {
        return { width, height };
    }

    const ratio = Math.min(maxWidth / width, maxHeight / height);
    return {
        width: Math.round(width * ratio),
        height: Math.round(height * ratio)
    };
}

function compressImage(
    img: HTMLImageElement,
    options: Required<ImagePreprocessOptions>,
    width: number,
    height: number
): Promise<Blob> {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');

    ctx.drawImage(img, 0, 0, width, height);
    return canvas.convertToBlob({ type: options.type, quality: options.quality });
}

export async function preprocessImage(
    file: File,
    options: ImagePreprocessOptions
): Promise<{ blob: Blob; width: number; height: number }> {
    const resolved = { ...options, type: options.type ?? 'image/webp' };
    const img = await loadImage(file);
    const { width, height } = calculateDimensions(
        img.width,
        img.height,
        resolved.maxWidth,
        resolved.maxHeight
    );

    if (file.type === resolved.type && width === img.width && height === img.height) {
        return { blob: file, width, height };
    }

    const blob = await compressImage(img, resolved, width, height);
    return { blob, width, height };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
                return;
            }
            reject(new Error('Failed to read image data URL'));
        };
        reader.onerror = () => reject(new Error('Failed to read image data URL'));
        reader.readAsDataURL(blob);
    });
}
