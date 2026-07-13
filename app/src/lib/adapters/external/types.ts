import { AppError } from '$lib/types/errors';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export interface IExternalAdapter {
    openUrl(url: string): Promise<void>;
}

export function normalizeExternalUrl(value: string): string {
    let url: URL;
    try {
        url = new URL(value, globalThis.location?.href);
    } catch (error) {
        throw new AppError('INVALID_INPUT', 'This link is not a valid URL.', error);
    }

    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
        throw new AppError('INVALID_INPUT', 'This link type cannot be opened externally.');
    }

    return url.href;
}
