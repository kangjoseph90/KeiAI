/**
 * Asset Remote API — KeiAI v3
 *
 * Thin client-side wrappers around the asset ciphertext endpoints.
 * Hard quota is enforced by the upload endpoint for the paying scope.
 */

import { isKeiServer, pb } from '$lib/adapters/pb';
import { appHttp } from '$lib/adapters/http';
import { AppError } from '$lib/types/errors';
import { KEI_CDN_URL } from '$lib/config';
import { buildUrl, normalizeUrl } from '$lib/utils/url';

// ─── Types ───────────────────────────────────────────────────────────

export interface UploadResult {
    status: 'stored' | 'exists';
    hash: string;
}

export type UploadAssetOptions = {
    roomId?: string;
};

type AssetApiError = {
    status?: number;
    message?: string;
    response?: {
        error?: string;
        message?: string;
    };
};

// ─── Helpers ─────────────────────────────────────────────────────────

function getCiphertextUrl(hash: string): string {
    if (isKeiServer()) {
        return buildUrl(KEI_CDN_URL, `/assets/${hash}.bin`);
    }
    return buildUrl(pb.baseUrl, `/api/assets/download/${encodeURIComponent(hash)}`);
}

function authHeaders(): Record<string, string> {
    return pb.authStore.token ? { Authorization: pb.authStore.token } : {};
}

function toAppError(error: unknown): unknown {
    const candidate = error as AssetApiError;
    const status = candidate?.status;
    const message =
        candidate?.response?.message ?? candidate?.response?.error ?? candidate?.message;

    if (status === 402 || status === 413 || status === 429) {
        return new AppError('QUOTA_EXCEEDED', message ?? 'Asset upload limit exceeded.', error);
    }

    if (status === 401 || status === 403) {
        return new AppError('NOT_AUTHENTICATED', message ?? 'Authentication required.', error);
    }

    if (status === 404) {
        return new AppError('NOT_FOUND', message ?? 'Remote asset not found.', error);
    }

    if (status && status >= 400) {
        return new AppError('NETWORK_ERROR', message ?? 'Asset API request failed.', error);
    }

    return error;
}

// ─── API Functions ───────────────────────────────────────────────────

export async function uploadAsset(
    hash: string,
    ciphertext: Uint8Array,
    options: UploadAssetOptions = {}
): Promise<UploadResult> {
    try {
        const path = options.roomId
            ? `/api/multi-rooms/${encodeURIComponent(options.roomId)}/assets/${encodeURIComponent(hash)}`
            : `/api/assets/${encodeURIComponent(hash)}`;
        const response = await appHttp.fetch(
            buildUrl(pb.baseUrl, path),
            {
                method: 'PUT',
                headers: {
                    ...authHeaders(),
                    'Content-Type': 'application/octet-stream'
                },
                body: ciphertext as unknown as BodyInit
            },
            { timeout: 30_000, retry: { maxRetries: 1 } }
        );

        if (!response.ok) {
            throw {
                status: response.status,
                message: await response.text().catch(() => response.statusText)
            };
        }

        return (await response.json()) as UploadResult;
    } catch (error) {
        throw toAppError(error);
    }
}

export async function fetchAssetCiphertext(hash: string): Promise<Uint8Array | null> {
    try {
        const response = await appHttp.fetch(
            getCiphertextUrl(hash),
            {
                method: 'GET',
                headers: isKeiServer() ? undefined : authHeaders()
            },
            { timeout: 15_000, retry: { maxRetries: 2 } }
        );
        if (!response.ok) {
            await response.text().catch(() => undefined);
            return null;
        }
        return new Uint8Array(await response.arrayBuffer());
    } catch {
        return null;
    }
}
