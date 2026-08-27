/**
 * Binary encoding / decoding utilities.
 *
 * Supports conversion between:
 *   - Raw bytes (Uint8Array)
 *   - Base64 strings (for JSON storage)
 *   - Hex strings (for URL hashes and encryption keys)
 */

type Bytes = Uint8Array<ArrayBuffer>;

/** Chunk size keeps String.fromCharCode arguments under engine limits. */
const BASE64_CHUNK_SIZE = 0x8000;

/**
 * Convert raw bytes to a Base64 string.
 */
export function toBase64(bytes: Uint8Array<ArrayBufferLike>): string {
    let binary = '';
    for (let index = 0; index < bytes.length; index += BASE64_CHUNK_SIZE) {
        binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK_SIZE));
    }
    return btoa(binary);
}

/**
 * Convert a Base64 string back to raw bytes.
 */
export function fromBase64(base64: string): Bytes {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/**
 * Convert raw bytes to a Hex string.
 */
export function toHex(bytes: Bytes | ArrayBuffer): string {
    const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return Array.from(array)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Convert a Hex string back to raw bytes.
 */
export function fromHex(hex: string): Bytes {
    const normalizedHex = hex.startsWith('0x') ? hex.slice(2) : hex;
    const match = normalizedHex.match(/.{1,2}/g);
    if (!match) return new Uint8Array(0);

    const bytes = new Uint8Array(match.length);
    for (let i = 0; i < match.length; i++) {
        bytes[i] = parseInt(match[i], 16);
    }
    return bytes;
}
