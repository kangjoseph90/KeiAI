/**
 * SHA-256 Hashing Implementation.
 * Handles strings, byte views, and raw buffers.
 */

import { asBytes, textEncoder, toHex } from './encoding';

type Bytes = Uint8Array<ArrayBuffer>;

/**
 * Calculate SHA-256 hash of a buffer or string.
 * Returns the hex representation of the hash.
 */
export async function sha256(
    data: Uint8Array<ArrayBufferLike> | ArrayBuffer | string
): Promise<string> {
    return toHex(await crypto.subtle.digest('SHA-256', digestInput(data)));
}

/**
 * Calculate SHA-256 hash and return raw bytes.
 */
export async function sha256Bytes(
    data: Uint8Array<ArrayBufferLike> | ArrayBuffer | string
): Promise<Bytes> {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', digestInput(data)));
}

/** Byte views pass through whole: digest hashes only what the view spans. */
function digestInput(data: Uint8Array<ArrayBufferLike> | ArrayBuffer | string): BufferSource {
    if (typeof data === 'string') return textEncoder.encode(data);
    if (data instanceof Uint8Array) return asBytes(data);
    return data;
}
