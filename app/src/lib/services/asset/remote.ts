/**
 * Asset Remote API — KeiAI v2
 *
 * Client-side wrappers for the PocketBase asset endpoints.
 * The server handles all complexity (dedup, quota, refCount).
 */

import { pb } from '$lib/adapters/pb';
import { appHttp } from '$lib/adapters/http';
import { AppError } from '$lib/shared/errors';
import type { AssetKind } from './types';

// ─── Types ───────────────────────────────────────────────────────────

export type UploadStatus = 'uploaded' | 'ref_count_increased' | 'freeride_ok' | 'public_available';

export interface UploadResult {
	status: UploadStatus;
	hash: string;
}

export interface PromoteResult {
	status: 'promoted' | 'already_public';
	hash: string;
}

// ─── Error Handling ──────────────────────────────────────────────────

type AssetApiError = {
	status?: number;
	message?: string;
	response?: {
		error?: string;
		message?: string;
	};
};

function toAppError(error: unknown): unknown {
	const candidate = error as AssetApiError;
	const status = candidate?.status;
	const message = candidate?.response?.message ?? candidate?.response?.error ?? candidate?.message;

	if (status === 402 || status === 413) {
		return new AppError('QUOTA_EXCEEDED', message ?? 'Asset quota exceeded.', error);
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

/**
 * Upload an asset binary to the server.
 * The server handles: dedup (same hash), quota check, refCount management.
 * Any non-error response means the asset is available on the server.
 */
export async function uploadAsset(
	hash: string,
	kind: AssetKind,
	size: number,
	file: Uint8Array
): Promise<UploadResult> {
	try {
		const formData = new FormData();
		formData.append('hash', hash);
		formData.append('kind', kind);
		formData.append('size', size.toString());
		formData.append('file', new Blob([file as unknown as BlobPart]), `${hash}.bin`);

		return (await pb.send('/api/assets/upload', {
			method: 'POST',
			body: formData
		})) as UploadResult;
	} catch (error) {
		throw toAppError(error);
	}
}

/**
 * Delete a remote asset (decrement refCount, delete if last reference).
 * Non-owner or missing asset returns 200 noOp — not an error.
 */
export async function deleteRemoteAsset(hash: string): Promise<void> {
	if (!pb.authStore.isValid) return;

	try {
		await pb.send(`/api/assets/${encodeURIComponent(hash)}`, {
			method: 'DELETE'
		});
	} catch (error) {
		throw toAppError(error);
	}
}

/**
 * Promote a private asset to public by uploading the plaintext file.
 * The server replaces the encrypted version and refunds the quota.
 */
export async function promoteAsset(hash: string, file: Uint8Array): Promise<PromoteResult> {
	try {
		const formData = new FormData();
		formData.append('file', new Blob([file as unknown as BlobPart]), `${hash}.bin`);

		return (await pb.send(`/api/assets/promote/${encodeURIComponent(hash)}`, {
			method: 'PUT',
			body: formData
		})) as PromoteResult;
	} catch (error) {
		throw toAppError(error);
	}
}

/**
 * Fetch asset bytes from the CDN.
 * Uses appHttp for cross-platform CORS bypass.
 */
export async function fetchAssetFromCDN(url: string): Promise<Uint8Array | null> {
	try {
		const response = await appHttp.fetch(url, undefined, { 
			timeout: 15_000, 
			retry: { maxRetries: 2 } 
		});
		if (!response.ok) {
			await response.text().catch(() => {});
			return null;
		}
		const buffer = await response.arrayBuffer();
		return new Uint8Array(buffer);
	} catch {
		return null;
	}
}
